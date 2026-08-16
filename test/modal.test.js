import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MODAL_ENDPOINT_URL = '';
process.env.MODAL_GROUND_URL = '';
process.env.MODAL_FOLD_URL = '';
process.env.MODAL_TOKEN_ID = '';
process.env.MODAL_TOKEN_SECRET = '';
process.env.MODAL_GROUND_MODEL = '';
process.env.MODAL_FOLD_MODEL = '';

const { locateQuote, parseBackbone, foldSequence, groundClaim } = await import('../src/modal/tasks.js');
const { redact, modalStatus } = await import('../src/modal/client.js');
const { config } = await import('../src/config.js');

test('an unconfigured Modal is inert rather than broken', async () => {
  assert.equal(await foldSequence({ sequence: 'MKTAYIAKQRQISFVKSHFSRQ' }), null);
  assert.equal(await groundClaim({ claim: 'anything', passages: [] }), null);

  const status = modalStatus();
  assert.equal(status.configured, false);
  assert.equal(status.hasTokenSecret, false);
  assert.equal(status.tasks.ground.host, null);
  assert.equal(status.tasks.fold.host, null);
});

test('status never carries the token itself', () => {
  const status = modalStatus();
  assert.equal('tokenId' in status, false);
  assert.equal('tokenSecret' in status, false);
  assert.deepEqual(Object.keys(status).sort(), ['configured', 'hasTokenId', 'hasTokenSecret', 'tasks']);
  for (const task of Object.values(status.tasks)) {
    assert.deepEqual(Object.keys(task).sort(), ['configured', 'host', 'mode', 'model']);
  }
});

test('one task can be configured without the other', async () => {
  // A workspace with a language model and no folder is the normal case: an LLM
  // and a structure predictor are separate deployments.
  config.modal.tokenId = 'wk-test';
  config.modal.tokenSecret = 'ws-test';
  config.modal.tasks.ground.url = 'https://example--kimi.modal.run';
  config.modal.tasks.fold.url = '';
  try {
    const status = modalStatus();
    assert.equal(status.configured, true);
    assert.equal(status.tasks.ground.configured, true);
    assert.equal(status.tasks.fold.configured, false);
    assert.equal(status.tasks.ground.host, 'example--kimi.modal.run');

    // Folding stays inert rather than borrowing the grounding endpoint.
    assert.equal(await foldSequence({ sequence: 'MKTAYIAKQRQISFVKSHFSRQ' }), null);
  } finally {
    config.modal.tokenId = '';
    config.modal.tokenSecret = '';
    config.modal.tasks.ground.url = '';
    config.modal.tasks.fold.url = '';
  }
});

test('redaction catches every token shape that could reach a log', () => {
  // Synthetic values only. A test fixture is committed forever, so a real token
  // in one is a leaked token even if the test is correct.
  const line = 'auth wk-EXAMPLEexample1234567 and ws-abcdefghijklmnop plus ak-1234567890abcdef';
  const clean = redact(line);
  assert.match(clean, /wk-\*\*\*/);
  assert.match(clean, /ws-\*\*\*/);
  assert.match(clean, /ak-\*\*\*/);
  assert.equal(clean.includes('EXAMPLEexample1234567'), false);
});

test('a quote is located across the whitespace the source actually contains', () => {
  const source = 'The primary endpoint was\n   serum TTR reduction\tat day 28 in all cohorts.';
  const found = locateQuote(source, 'serum TTR reduction at day 28');
  assert.ok(found, 'the quote is present once whitespace is collapsed');
  assert.equal(source.slice(found.start, found.end).replace(/\s+/g, ' '), 'serum TTR reduction at day 28');
});

test('a paraphrase is not a citation and is refused', () => {
  const source = 'The primary endpoint was serum TTR reduction at day 28.';
  assert.equal(locateQuote(source, 'TTR levels fell substantially by four weeks'), null);
  // Too short to be evidence of anything.
  assert.equal(locateQuote(source, 'TTR'), null);
});

test('the backbone keeps one point per residue and reads its confidence column', () => {
  const pdb = [
    'ATOM      1  N   MET A   1      11.104  13.207  10.000  1.00 92.30           N',
    'ATOM      2  CA  MET A   1      12.560  13.207  10.000  1.00 92.30           C',
    'ATOM      3  C   MET A   1      13.000  14.600  10.000  1.00 92.30           C',
    'ATOM      4  CA  LYS A   2      15.000  16.000  11.000  1.00 78.10           C',
    'HETATM   99  O   HOH A 300      20.000  20.000  20.000  1.00  0.00           O',
  ].join('\n');

  const backbone = parseBackbone(pdb);
  assert.equal(backbone.length, 2, 'only alpha carbons survive');
  assert.deepEqual(
    backbone.map((point) => point.residue),
    ['MET', 'LYS'],
  );
  assert.equal(backbone[0].confidence, 92.3);
  assert.equal(backbone[1].x, 15);
});

test('a sequence that cannot honestly be folded is refused before it costs anything', async () => {
  // Configure just enough that the guard is the length check, not the config check.
  config.modal.tasks.fold.url = 'https://example--fold.modal.run';
  config.modal.tokenId = 'wk-test';
  config.modal.tokenSecret = 'ws-test';
  try {
    await assert.rejects(() => foldSequence({ sequence: 'MKTA' }), /too short/i);
    await assert.rejects(() => foldSequence({ sequence: 'A'.repeat(2400) }), /capped at 2000/);
  } finally {
    config.modal.tasks.fold.url = '';
    config.modal.tasks.ground.url = '';
    config.modal.tokenId = '';
    config.modal.tokenSecret = '';
  }
});

test('grounding verifies every span against its own passage', async (t) => {
  config.modal.tasks.ground.url = 'https://example--ground.modal.run';
  config.modal.tasks.ground.mode = 'json';
  config.modal.tokenId = 'wk-test';
  config.modal.tokenSecret = 'ws-test';

  const passage = {
    id: 'design_registry',
    title: 'Trial registry context',
    text: 'Patients received a single dose. The primary endpoint was serum TTR reduction at day 28.',
  };

  // Two real spans and two fabrications: one quoting a passage that was never
  // supplied, one paraphrasing a passage that was.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        spans: [
          { id: 'design_registry', quote: 'The primary endpoint was serum TTR reduction at day 28.', score: 0.94 },
          { id: 'design_registry', quote: 'Patients received a single dose.', score: 0.7 },
          { id: 'design_registry', quote: 'TTR fell by roughly ninety percent.', score: 0.99 },
          { id: 'a_passage_never_supplied', quote: 'Anything at all, at length.', score: 0.99 },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
    config.modal.tasks.fold.url = '';
    config.modal.tasks.ground.url = '';
    config.modal.tasks.ground.mode = 'openai';
    config.modal.tokenId = '';
    config.modal.tokenSecret = '';
  });

  const result = await groundClaim({ claim: 'The endpoint was TTR reduction at day 28.', passages: [passage] });

  assert.equal(result.checked, 4);
  assert.equal(result.rejected, 2, 'the paraphrase and the unknown passage are both dropped');
  assert.equal(result.spans.length, 2);
  for (const span of result.spans) {
    assert.equal(passage.text.slice(span.start, span.end), span.quote, 'offsets point at the quote verbatim');
  }
});

test('an OpenAI-compatible LLM endpoint is unwrapped, fences and all', async (t) => {
  // This is the shape a Kimi/vLLM deployment on Modal actually answers with:
  // a chat completion whose content is JSON, often inside a fenced block.
  config.modal.tasks.ground.url = 'https://workspace--kimi.modal.run';
  config.modal.tasks.ground.mode = 'openai';
  config.modal.tasks.ground.model = 'kimi';
  config.modal.tokenId = 'wk-test';
  config.modal.tokenSecret = 'ws-test';

  const passage = { id: 'p1', title: 'Registry', text: 'The trial enrolled 24 participants across six sites.' };
  let sentTo = null;
  let sentBody = null;
  let sentHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sentTo = url;
    sentHeaders = init.headers;
    sentBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '```json\n{"spans":[{"id":"p1","quote":"enrolled 24 participants across six sites","score":0.9}]}\n```',
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    config.modal.tasks.ground.url = '';
    config.modal.tasks.ground.model = '';
    config.modal.tokenId = '';
    config.modal.tokenSecret = '';
  });

  const result = await groundClaim({ claim: 'Twenty-four people were enrolled.', passages: [passage] });

  assert.equal(sentTo, 'https://workspace--kimi.modal.run/v1/chat/completions');
  assert.equal(sentHeaders.Authorization, 'Bearer wk-test.ws-test');
  assert.equal(sentHeaders['Modal-Secret'], undefined);
  assert.equal(sentBody.model, 'kimi');
  assert.equal(result.spans.length, 1);
  assert.equal(passage.text.slice(result.spans[0].start, result.spans[0].end), 'enrolled 24 participants across six sites');
});

test('a non-JSON reply fails loudly instead of producing an empty citation', async (t) => {
  config.modal.tasks.ground.url = 'https://example--ground.modal.run';
  config.modal.tasks.ground.mode = 'json';
  config.modal.tokenId = 'wk-test';
  config.modal.tokenSecret = 'ws-test';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>gateway error</html>', { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
    config.modal.tasks.fold.url = '';
    config.modal.tasks.ground.url = '';
    config.modal.tokenId = '';
    config.modal.tokenSecret = '';
  });

  await assert.rejects(
    () => groundClaim({ claim: 'anything', passages: [{ id: 'a', text: 'some retained passage text here' }] }),
    /not JSON/,
  );
});
