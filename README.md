# Knowledge UI

[简体中文](README_zh.md)

Knowledge UI renders interactive charts, diagrams, and controls inside Obsidian Markdown notes. Use sliders to explore a model, step through diagrams alongside highlighted code, or present formulas and tables. Keep explanations and conclusions in ordinary Markdown. Interactive state stays in memory for each block.

The Obsidian plugin, local browser preview, and validation CLI share Protocol v1 and its component definitions. The protocol includes 31 core components and a declarative template component.

## Install in Obsidian

1. Download `main.js`, `manifest.json`, and `styles.css` from the same [GitHub release](https://github.com/dgzn123/KnowledgeUI/releases/latest).
2. Close the vault, copy all three files to `<Vault>/.obsidian/plugins/knowledge-ui/`, then reopen Obsidian. If the vault uses a custom configuration folder, replace `.obsidian` with that folder.
3. Enable **Knowledge UI** under **Settings → Community plugins**. Copy the [Component Gallery](examples/Component%20Gallery.md) into the vault and open it in **Reading view**.

On Android, use a file manager that can show hidden directories. On iPhone and iPad, use a file tool that can access the vault and its hidden configuration folder. With Remotely Save or OneDrive, keep syncing the notes and install the same three plugin files on each device. [Obsidian configuration folders](https://obsidian.md/help/configuration-folder)

### Install, update, or roll back from source

Use Node.js 24.22.3 or a later Node.js 24 version and npm 11. Run these commands from the repository root. Replace the example path with your vault root. Let any pending sync finish and close the vault before deploying.

```sh
npm ci
npm run deploy -- --vault "/path/to/Vault"
```

Deployment runs the build and tests before installing the three plugin files. Run the same command to update and use the same checkout to keep its rollback history. Backups live in the checkout's `backups/` directory.

```sh
npm run rollback -- --vault "/path/to/Vault"
```

If an interrupted deployment reports `Recovery pending`, resolve the underlying file access or storage issue and run the rollback command with `--recover`. For a manual install from source, run `npm run build` and copy the three files from `dist/obsidian/`. Save the previous set outside the vault before a manual update.

## Try the local preview

Run the preview after installing dependencies with `npm ci`.

```sh
npm run preview
```

Open `http://127.0.0.1:4173/` and choose a note. The preview supports light and dark themes, four content widths, and local Markdown files. Use `npm run preview -- 4200` to select a different port. Browser previews show readable text for LaTeX, Obsidian links, and attachments.

The included teaching notes are written in Chinese.

| Example | What to try |
|---|---|
| [Component Gallery](examples/Component%20Gallery.md) | Browse all 32 component types, including layouts, controls, diagrams, and templates. |
| [MOSFET characteristics](examples/notes/mosfet.md) | Adjust voltages and the threshold, then inspect the curves and operating point. |
| [Linux processes and descriptors](examples/notes/linux-fork-exec-fd.md) | Step through `fork`, `exec`, and descriptor changes with synchronized code highlights. |
| [TCP handshake and congestion control](examples/notes/tcp-handshake-congestion.md) | Compare the handshake sequence and congestion window for different loss scenarios. |
| [Linked lists and tree traversal](examples/notes/linked-list-reversal.md) | Follow pointer changes and recursive visits one step at a time. |
| [Second-order system damping](examples/notes/second-order-system.md) | Compare the step response and frequency response as damping changes. |

## Write an interactive note

Paste this example into an Obsidian note and switch to Reading view. Moving the slider updates the reading in the same block.

````markdown
Move the slider and observe how the completion percentage changes.

```kui
version: 1
type: interactive
state:
  level: { type: number, label: Completion, default: 25, min: 0, max: 100, step: 5 }
layout:
  type: stack
  direction: column
  children:
    - type: slider
      bind: level
    - type: metric
      label: Completion
      value: "{{level}}"
      unit: "%"
```
````

`state` declares the value, `bind` connects the slider to it, and `{{level}}` passes the current value to the metric. Run the validator to check YAML, component fields, expressions, and extension references. [Protocol v1](skills/knowledge-ui/references/protocol.md) · [Component reference](skills/knowledge-ui/references/components.md)

```sh
npm run validate -- "/path/to/note.md"
```

## Codex Skill

The `knowledge-ui` Skill includes guidance on selecting components, designing interactions, and validating notes. On Linux, link it into the current repository from its root. If a skill with that name already exists, check its target first. [Skill instructions](skills/knowledge-ui/SKILL.md)

```sh
mkdir -p .agents/skills
ln -sT ../../skills/knowledge-ui .agents/skills/knowledge-ui
```

In a new Codex session, ask it to use `$knowledge-ui` to write a note with an interactive chart and validate the Markdown. To use the Skill from another repository, link that repository's `.agents/skills/knowledge-ui` to the absolute path of this checkout's `skills/knowledge-ui/` directory.

## Develop and verify

| Command | What it does |
|---|---|
| `npm run dev` | Rebuilds the plugin and preview when source files, styles, the manifest, or preview notes change. |
| `npm run check` | Checks TypeScript and the generated component reference. |
| `npm run test` | Runs automated tests, with host and system-call cases when the required local tools are available. |
| `npm run validate` | Validates the bundled Gallery, teaching notes, and Skill examples. |
| `npm run build` | Produces `dist/obsidian/`, `dist/preview/`, and `dist/contracts/`. |

The shared protocol, rendering, components, and adapters live in `src/`. The directories `cli/`, `preview/`, and `scripts/` contain the validator, preview page, and local tooling, respectively. Declarative symbols and templates in `src/extensions/` ship with both hosts and the CLI.

The plugin renders locally inside Obsidian and works offline. The project has been tested on Linux with Chromium and Obsidian 1.15.1, including Reading view, Live Preview, and installation and rollback in temporary vaults. Windows, macOS, iOS, iPadOS, and Android await device testing. A peak in the second-order step response can fall beyond the example's fixed 12-second chart window.

## License

The project uses the [MIT license](LICENSE) starting with version 0.1.1. The bundled [YAML parser](https://github.com/eemeli/yaml) uses the ISC license. Its notice ships in the JavaScript bundle.
