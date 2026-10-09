# Community submission checklist

1. Review LICENSE (MIT), public source and privacy/network statements. Do not commit private Vault notes or credentials.
2. Merge the release PR into `main` after CI and maintainer approval.
3. GitHub **Actions > Publish Community Release (manual) > Run workflow** on `main`, enter `0.5.0` (no `v`). Confirm the new GitHub Release contains `main.js`, `manifest.json`, `styles.css`.
4. Visit https://community.obsidian.md/ and sign in. Connect your GitHub account via profile.
5. Choose **Plugins > New plugin**, paste https://github.com/WilsonWukz/obsidian-evidence-weave, accept the policies and submit.
6. Resolve any automated review issues with a new incremented release. Do not claim public listing until the directory approves it.

Use the 2026 Community directory form, not a pull request to obsidian-releases.
Official guide: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
