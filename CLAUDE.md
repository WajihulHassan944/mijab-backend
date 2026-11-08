# MIJAB backend

Production for mijab-backend.vercel.app deploys automatically from the `main` branch of this repo, so when work is ready to go live, commit and push it to `main` (not a `claude/*` branch) and don't use `vercel deploy --prod` from a local folder. Vercel doesn't build `claude/*` branches (see `vercel.json`). Deploy backend changes before the frontend changes that depend on them.
