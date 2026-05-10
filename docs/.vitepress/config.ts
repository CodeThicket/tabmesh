import { defineConfig } from 'vitepress';

// Site config for tabmesh.dev. Layout: landing at /, deep content under
// /guide, /reference, /recipes, /adr, /roadmap, and the playground iframe
// at /playground. ADRs are picked up directly from docs/adr/ — no
// duplication between repo-internal architecture decisions and the
// public site.
export default defineConfig({
  lang: 'en-US',
  title: 'TabMesh',
  description:
    'One backend connection, every browser tab. SharedWorker-primary event mesh with elected-leader fallback.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#646cff' }],
    ['meta', { property: 'og:title', content: 'TabMesh' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'One backend connection, every browser tab.',
      },
    ],
  ],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/tabmesh-class' },
      { text: 'Recipes', link: '/recipes/' },
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'Playground', link: '/playground' },
      {
        text: 'GitHub',
        link: 'https://github.com/CodeThicket/tabmesh',
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'What is TabMesh?', link: '/guide/what-is-tabmesh' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Gotchas', link: '/guide/gotchas' },
            { text: 'React', link: '/guide/react' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'TabMesh class', link: '/reference/tabmesh-class' },
            { text: 'Configuration', link: '/reference/config' },
            { text: 'System events', link: '/reference/system-events' },
            { text: 'Types', link: '/reference/types' },
          ],
        },
      ],
      '/recipes/': [
        {
          text: 'Recipes',
          items: [
            { text: 'Index', link: '/recipes/' },
            { text: 'Auth & logout', link: '/recipes/auth-and-logout' },
            { text: 'Custom transport', link: '/recipes/custom-transport' },
            { text: 'Service Worker handoff', link: '/recipes/service-worker-handoff' },
          ],
        },
      ],
      '/adr/': [
        {
          text: 'Architecture Decisions',
          items: [
            { text: 'Index', link: '/adr/' },
            {
              text: '0001 — Write-through Outbox',
              link: '/adr/0001-write-through-outbox',
            },
            {
              text: '0002 — SharedWorker primary Hub',
              link: '/adr/0002-sharedworker-primary-hub',
            },
            {
              text: '0003 — Pre-built worker bundles',
              link: '/adr/0003-distribute-prebuilt-worker-bundles',
            },
            {
              text: '0004 — VitePress single site',
              link: '/adr/0004-vitepress-single-site-at-tabmesh-dev',
            },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/CodeThicket/tabmesh' }],
    search: {
      provider: 'local',
    },
    editLink: {
      pattern: 'https://github.com/CodeThicket/tabmesh/edit/main/docs/:path',
      text: 'Suggest changes to this page',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present TabMesh contributors',
    },
  },
});
