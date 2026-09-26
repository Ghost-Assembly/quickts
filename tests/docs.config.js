// What tests/docs.spec.js holds QuickTS's docs site to. The spec is shared
// across the extensions; this file is QuickTS's own.

export default {
    title: 'QuickTS',
    site: 'https://ghost-assembly.github.io/quickts/',
    repo: 'https://github.com/Ghost-Assembly/quickts',

    // [id, heading], in page order. The contents list must match.
    sections: [
        ['overview', 'Overview'],
        ['install', 'Install'],
        ['menu', 'The menu'],
        ['preferences', 'Preferences'],
        ['keyboard', 'Keyboard shortcut'],
        ['security', 'Security'],
        ['architecture', 'Architecture'],
        ['localapi', 'The LocalAPI'],
        ['testing', 'Testing'],
        ['packaging', 'Packaging'],
        ['releasing', 'Releasing'],
        ['development', 'Development'],
    ],
};
