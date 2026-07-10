# Sahil LinkedIn Automation

Generates one original LinkedIn post every day and adds it to the connected personal LinkedIn channel in Buffer.

## How it works

- GitHub Actions runs every day at 9:00 AM India time.
- OpenAI generates a post in Sahil's defined voice and rotates the content pillar daily.
- The workflow automatically finds the active LinkedIn channel in Buffer.
- It adds the post to the Buffer queue.
- Buffer publishes it at the next configured queue time.

## One-time setup

### 1. Set the Buffer queue

In Buffer, set the personal LinkedIn posting schedule to one daily slot at **9:30 AM**, using the **Asia/Kolkata** timezone.

### 2. Create the Buffer API key

In Buffer, open **Settings → API → Personal Keys → New Key**.

- Name: `GitHub LinkedIn Automation`
- Permissions: account read, posts write and posts read
- Expiration: 1 year

Do not put the API key in any repository file.

### 3. Create the OpenAI API key

Create an OpenAI Platform API key and ensure API billing is enabled. ChatGPT subscriptions and API billing are separate.

### 4. Add encrypted repository secrets

Open this GitHub repository and go to:

**Settings → Secrets and variables → Actions → New repository secret**

Add:

- `OPENAI_API_KEY`
- `BUFFER_API_KEY`

Optional repository variable:

- Name: `OPENAI_MODEL`
- Value: `gpt-5.6`

### 5. Test safely

Go to **Actions → Daily LinkedIn Post → Run workflow** and leave `dry_run` enabled.

If it passes, run it once with `dry_run` disabled. Confirm the post appears in Buffer. The daily schedule will then continue automatically.

## Security

- Never commit API keys.
- Keep the repository private after the initial upload.
- Regenerate the Buffer key before expiry.
- Disable the GitHub Actions workflow to pause posting.
