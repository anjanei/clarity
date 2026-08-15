/**
 * Paperclip connectivity + command sandbox.
 *
 *   npm run probe                                   handshake + tool list
 *   npm run probe -- --skill                        the server's own docs
 *   npm run probe -- --skill proteins               one domain reference
 *   npm run probe -- --search "pembrolizumab immunogenicity" --source pmc
 *   npm run probe -- --search "phase 3 NSCLC" --path /trials/us --limit 10
 *   npm run probe -- --raw 'search -s fda "semaglutide" -n 5'
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { paperclip } from '../paperclip/client.js';
import { checkConnection, run, search, skill } from '../paperclip/tools.js';
import { config, paths, requireKeys } from '../config.js';

function parseArgs(argv) {
  const args = { search: null, source: null, path: null, limit: 5, raw: null, skill: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--search':
        args.search = argv[++i];
        break;
      case '--source':
        args.source = argv[++i];
        break;
      case '--path':
        args.path = argv[++i];
        break;
      case '--limit':
        args.limit = Number(argv[++i]) || args.limit;
        break;
      case '--raw':
        args.raw = argv[++i];
        break;
      case '--skill':
        // Optional domain argument; bare --skill loads the core doc.
        args.skill = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
        break;
      default:
        break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireKeys('paperclip');

  console.log(`Connecting to ${config.paperclip.mcpUrl}`);
  const handshake = await paperclip.connect();
  console.log(
    `Server: ${handshake?.serverInfo?.name ?? 'unknown'} ${handshake?.serverInfo?.version ?? ''} ` +
      `(protocol ${handshake?.protocolVersion ?? 'unknown'})\n`,
  );

  const tools = await paperclip.listTools();
  console.log(`${tools.length} tool(s):`);
  for (const tool of tools) {
    const props = Object.keys(tool.inputSchema?.properties || {});
    console.log(`  ${tool.name}  args: ${props.join(', ') || '(none declared)'}`);
  }

  const connection = await checkConnection();
  console.log(`\nDriving the CLI through the "${connection.toolName}" tool.`);

  await fs.mkdir(paths.probe, { recursive: true });
  const dump = path.join(paths.probe, 'tools.json');
  await fs.writeFile(dump, `${JSON.stringify({ handshake, tools }, null, 2)}\n`, 'utf8');
  console.log(`Full schemas written to ${path.relative(paths.root, dump)}`);

  if (args.skill !== undefined) {
    const result = await skill(args.skill || undefined);
    const file = path.join(paths.probe, args.skill ? `skill-${args.skill}.md` : 'skill.md');
    await fs.writeFile(file, `${result.text}\n`, 'utf8');
    console.log(
      `\n$ ${result.command}\n  ${result.text.length} chars -> ${path.relative(paths.root, file)}`,
    );
  }

  if (args.search) {
    console.log(`\n$ searching…`);
    const result = await search(args.search, {
      source: args.source ?? (args.path ? undefined : 'pmc'),
      path: args.path ?? undefined,
      limit: args.limit,
    });
    console.log(`$ ${result.command}\n`);
    console.log(result.text.slice(0, 6000));
  }

  if (args.raw) {
    const result = await run(args.raw);
    console.log(`\n$ ${result.command}\n`);
    console.log(result.text.slice(0, 6000));
  }
}

main().catch((err) => {
  console.error(`\nProbe failed: ${err.message}`);
  if (err.data) console.error(JSON.stringify(err.data, null, 2).slice(0, 2000));
  process.exitCode = 1;
});
