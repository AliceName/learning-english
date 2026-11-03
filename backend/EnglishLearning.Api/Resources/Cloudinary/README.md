# Cloudinary environment smoke fixture

`smoke-match.ogg` is the unmodified original recording **En-us-match.ogg**, by **Dvortygirl**, licensed **CC BY-SA 3.0**.

- Source: https://commons.wikimedia.org/wiki/File:En-us-match.ogg
- Original: https://upload.wikimedia.org/wikipedia/commons/a/ad/En-us-match.ogg
- License: https://creativecommons.org/licenses/by-sa/3.0/
- SHA-256: `71bec08d01a0622ac95c4290aa256104cf11745f61b323f1e3e2f659a3bf5866`

Embedded only for the explicitly invoked Cloudinary smoke check; it is not an application audio cache. Each run uploads three tiny fixtures to a unique development/test prefix, checks authenticated streaming and audio ranges, then deletes only its own uploaded IDs. The JSON fixture carries the recording's attribution. PNG and JSON fixture bytes are generated in code. No SQL/MongoDB or listening server is involved.
