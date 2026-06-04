# CLI Setup and Authentication

Before you can scaffold or publish a That Open Platform app, two things must be in place: the `@thatopen/services` CLI installed globally, and a valid platform token for authentication.

---

## Step 1: Install or update the CLI

Run the following command in the terminal. This installs the CLI if it isn't present, or updates it to the latest version if it already is:

```bash
npm i @thatopen/services@latest -g
```

Once done, verify it works:

```bash
thatopen --version
```

If this returns a version number, the CLI is ready. If `npm` is not found, install Node.js first — download the LTS version from [https://nodejs.org](https://nodejs.org), then retry.

---

## Step 2: Get a platform token

Generate an access token from the platform:

1. Go to [https://dev.platform.thatopen.com](https://dev.platform.thatopen.com)
2. In the header, click **Data**
3. Find the **Tokens** card and create a new token
4. Enable the permissions: **Apps**, **Components** and **Storage**
5. Copy the token

---

## Step 3: Authenticate

Once you have the token, run:

```bash
npm run login -- --token <TOKEN>
```

where `<TOKEN>` is the token you copied. This stores credentials globally at `~/.thatopen/config.json` and persists across sessions — you only need to do this once per machine.

---

## When to use this guide

Read this guide when:
- You are starting a new app and haven't confirmed the CLI is installed
- A `thatopen` command fails with a "command not found" or "not authenticated" error
- You have never built a platform app before on this machine
