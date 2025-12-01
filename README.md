<p align="center">
  <a href="https://nextjs-flask-starter.vercel.app/">
    <img src="https://assets.vercel.com/image/upload/v1588805858/repositories/vercel/logo.png" height="96">
    <h3 align="center">Next.js Flask Starter</h3>
  </a>
</p>

<p align="center">Simple Next.js boilerplate that uses <a href="https://flask.palletsprojects.com/">Flask</a> as the API backend.</p>

<br/>

## Introduction

This repository hosts the hybrid participant survey used for the AI misinformation study. The UI is a Next.js app that handles the participant onboarding flow, while the Flask backend manages the OpenAI conversation, attaches belief PDFs, and records metadata needed for Qualtrics follow-ups.

## How It Works

The Python/Flask server is mapped into to Next.js app under `/api/`.

This is implemented using [`next.config.js` rewrites](https://github.com/vercel/examples/blob/main/python/nextjs-flask/next.config.js) to map any request to `/api/:path*` to the Flask API, which is hosted in the `/api` folder.

On localhost, the rewrite will be made to the `127.0.0.1:5328` port, which is where the Flask server is running.

In production, the Flask server is hosted as [Python serverless functions](https://vercel.com/docs/concepts/functions/serverless-functions/runtimes/python) on Vercel.

## Survey configuration

- Edit `config/scenarios.json` to manage every agent persona and belief assignment used in the study. Each agent entry controls the display name, title, avatar initials, intro message, and prompt id that is sent to OpenAI. Each belief entry stores the Google Doc URL that is injected into the conversation context (the assistant receives the linked PDF before greeting the respondent).
- Both the frontend and backend load this JSON file directly, so any change is immediately reflected in the UI and the Flask API without duplicating settings in two places. Review the keys (e.g., `pd`, `i`, `p`, `20`, `covid`, `16`) before crafting Qualtrics redirect links.

## Qualtrics hand-off parameters

Qualtrics should redirect respondents to this site with three query parameters in the URL:

| Key | Purpose | Example |
| --- | --- | --- |
| `responder_id` (alias `rid`) | Unique Qualtrics response identifier. Stored in the conversation metadata and attached to every response request. | `responder_id=R_12345` |
| `a` | Obfuscated agent key. Maps to one of the entries in `config/scenarios.json`. | `a=m` |
| `b` | Obfuscated belief key. Maps to one of the belief entries. | `b=c` |

The welcome page surfaces these assignments (and lets you edit the responder id if you need to paste it manually), while the session view rehydrates the agent/belief metadata for display even after a refresh.

## Demo

https://nextjs-flask-starter.vercel.app/

## Deploy Your Own

You can clone & deploy it to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?demo-title=Next.js%20Flask%20Starter&demo-description=Simple%20Next.js%20boilerplate%20that%20uses%20Flask%20as%20the%20API%20backend.&demo-url=https%3A%2F%2Fnextjs-flask-starter.vercel.app%2F&demo-image=%2F%2Fimages.ctfassets.net%2Fe5382hct74si%2F795TzKM3irWu6KBCUPpPz%2F44e0c6622097b1eea9b48f732bf75d08%2FCleanShot_2023-05-23_at_12.02.15.png&project-name=Next.js%20Flask%20Starter&repository-name=nextjs-flask-starter&repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fexamples%2Ftree%2Fmain%2Fpython%2Fnextjs-flask&from=vercel-examples-repo)

## Getting Started

1. **Clone and install PNPM dependencies**

   ```bash
   pnpm install
   ```

2. **Provide the shared password**

   - Create a `.env` file or export `PASSWORD` in your shell. The Flask routes require a bearer token and the frontend automatically includes whatever you type on the welcome page, so make sure this matches.

3. **Run the local stack**

   ```bash
   pnpm run dev
   ```

   The `scripts/dev.sh` helper will:

   - Ensure `node_modules` is installed.
   - Create `.venv` (if missing) and install `requirements.txt`.
   - Start the Next.js dev server on `http://localhost:3000`.
   - Start the Flask API on `http://127.0.0.1:5328`.

4. **Test with a sample link**

   Open `http://localhost:3000/?a=pd&b=20&responder_id=TEST123` in your browser. This loads the “pd” agent and “20” belief (matching the keys in `config/scenarios.json`) and seeds the responder id so you can walk through the full flow. The backend will be reachable at [`http://127.0.0.1:5328/api/hello`](http://127.0.0.1:5328/api/hello) for quick checks.

## Testing

The `scripts/dev.sh` entry point already installs the backend packages inside `.venv`. To run the backend tests manually:

```bash
python3 -m venv .venv
PYTHONPATH=. .venv/bin/pip install -r requirements.txt
PYTHONPATH=. .venv/bin/pytest api/tests
```

Type checking is enforced with:

```bash
PYTHONPATH=. .venv/bin/mypy api
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Flask Documentation](https://flask.palletsprojects.com/en/1.1.x/) - learn about Flask features and API.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!
