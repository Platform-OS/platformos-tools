import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { jsonc } from '@platformos/lang-jsonc';
import { vim } from '@replit/codemirror-vim';
import MarkdownIt from 'markdown-it';
// import { oneDark } from '@codemirror/theme-one-dark';
// import { liquid, liquidHighLightStyle } from '@platformos/lang-liquid';

import { CodeMirrorLanguageClient } from '@platformos/codemirror-language-client';
import { MarkedString, MarkupContent } from 'vscode-languageserver-protocol';

const md = new MarkdownIt();

const exampleTemplate = `{% # app/views/partials/header.liquid %}
{% # mod-alt-v for vim mode %}
{% doc %}
  @param {string} title - The page title
  @param {boolean} [show_nav] - Whether to show the navigation
{% enddoc %}
<header>
  <h1>{{ title }}</h1>
  <p>{{ 'header.welcome' | t }}</p>
  {% if context.current_user %}
    <span>{{ 'header.greeting' | t: name: context.current_user.name }}</span>
    <a href="/logout">{{ 'header.logout' | t }}</a>
  {% endif %}
  {% if show_nav %}
    {% render 'nav' %}
  {% endif %}
</header>
`;

const exampleTranslations = {
  header: {
    welcome: 'Welcome to our platform',
    greeting: 'Hello, {{ name }}!',
    logout: 'Log out',
  },
  navigation: {
    home: 'Home',
    about: 'About',
  },
};

const exampleNavPartial = `{% # app/views/partials/nav.liquid %}
<nav>
  <ul>
    <li><a href="/">{{ 'navigation.home' | t }}</a></li>
    <li><a href="/about">{{ 'navigation.about' | t }}</a></li>
    {% for item in context.models %}
      <li><a href="{{ item.url }}">{{ item.title }}</a></li>
    {% endfor %}
  </ul>
</nav>
`;

function asMarkdown(content: MarkupContent | MarkedString[] | MarkedString): string {
  if (Array.isArray(content)) {
    return content.map((c) => asMarkdown(c)).join('\n');
  }

  if (typeof content === 'string') {
    return content;
  }

  if (MarkupContent.is(content)) {
    return content.value;
  }

  if (!content) {
    return '';
  }

  return `\`\`\`${content.language}\n${content.value}\n\`\`\``;
}

let vimEnabled = false;
const vimCompartment = new Compartment();

async function main() {
  const worker = new Worker(new URL('./language-server-worker.ts', import.meta.url));

  const client = new CodeMirrorLanguageClient(
    worker,
    {
      initializationOptions: {
        'platformosCheck.preloadOnBoot': false,
      },
    },
    {
      autocompleteOptions: {
        activateOnTyping: true,
        maxRenderedOptions: 20,
        defaultKeymap: true,
      },
      infoRenderer: (completionItem) => {
        if (!completionItem.documentation || typeof completionItem.documentation === 'string') {
          return null;
        }
        const node = document.createElement('div');
        const htmlString = md.render(completionItem.documentation.value);
        node.innerHTML = htmlString;
        return node;
      },
      hoverRenderer: (_, hover) => {
        const node = document.createElement('div');
        const htmlString = md.render(asMarkdown(hover.contents));
        node.innerHTML = htmlString;
        return {
          dom: node,
        };
      },
    },
  );

  await client.start();

  client.client.onRequest('fs/readFile' as any, ([uri]: string) => {
    switch (uri) {
      case 'browser:/app/views/partials/header.liquid':
        return exampleTemplate;
      case 'browser:/app/views/partials/nav.liquid':
        return exampleNavPartial;
      case 'browser:/app/translations/en.default.json':
        return JSON.stringify(exampleTranslations, null, 2);
      default:
        throw new Error(`File does not exist ${uri}`);
    }
  });

  client.client.onRequest('fs/stat' as any, ([uri]: string) => {
    switch (uri) {
      case 'browser:/.platformos-check.yml':
      case 'browser:/app/translations/en.default.json':
      case 'browser:/app/views/partials/header.liquid':
      case 'browser:/app/views/partials/nav.liquid':
        return { fileType: 1, size: 1 };
      default:
        throw new Error(`File does not exist: ${uri}`);
    }
  });

  client.client.onRequest('fs/readDirectory' as any, ([uri]: string) => {
    switch (uri) {
      case 'browser:/': {
        return [
          ['browser:/app', 2],
          ['browser:/.platformos-check.yml', 1],
        ];
      }
      case 'browser:/app': {
        return [
          ['browser:/app/views', 2],
          ['browser:/app/translations', 2],
        ];
      }
      case 'browser:/app/translations': {
        return [['browser:/app/translations/en.default.json', 1]];
      }
      case 'browser:/app/views': {
        return [['browser:/app/views/partials', 2]];
      }
      case 'browser:/app/views/partials': {
        return [
          ['browser:/app/views/partials/header.liquid', 1],
          ['browser:/app/views/partials/nav.liquid', 1],
        ];
      }
      default: {
        throw new Error(`directory does not exist: '${uri}'`);
      }
    }
  });

  const vimConfig = [
    vimCompartment.of([]),
    keymap.of([
      {
        key: 'Mod-Alt-v',
        run: () => {
          [liquidEditor, translationsEditor, navPartialEditor].forEach((view) => {
            view.dispatch({
              effects: vimCompartment.reconfigure([vimEnabled ? [] : vim({ status: true })]),
            });
          });
          vimEnabled = !vimEnabled;
          return true;
        },
      },
    ]),
  ];

  const liquidEditor = new EditorView({
    state: EditorState.create({
      doc: exampleTemplate,
      extensions: [
        vimConfig,
        basicSetup,
        // liquid(),
        // liquidHighLightStyle,
        // oneDark,
        client.extension('browser:/app/views/partials/header.liquid'),
      ],
    }),
    parent: document.getElementById('liquid-editor')!,
  });

  const translationsEditor = new EditorView({
    state: EditorState.create({
      doc: JSON.stringify(exampleTranslations, null, 2),
      extensions: [
        vimConfig,
        basicSetup,
        jsonc(),
        // oneDark,
        client.extension('browser:/app/translations/en.default.json'),
      ],
    }),
    parent: document.getElementById('translations-editor')!,
  });

  const navPartialEditor = new EditorView({
    state: EditorState.create({
      doc: exampleNavPartial,
      extensions: [
        vimConfig,
        basicSetup,
        jsonc(),
        // liquidHighLightStyle,
        // oneDark,
        client.extension('browser:/app/views/partials/nav.liquid'),
      ],
    }),
    parent: document.getElementById('nav-partial-editor')!,
  });
}

main();
