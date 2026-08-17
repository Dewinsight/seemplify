# Seemplify access vault

`access.zip` is the only credential-vault artifact allowed in Git. Its file
contents are encrypted with WinZip AES-256. The plaintext `access/` directory
and the unlock key must never be committed.

## Unlock key

The current local key is stored outside the repository at:

```text
C:\Users\Michael\.seemplify\access-vault.key
```

The key is restricted to the local Windows user and SYSTEM. Copy it to another
PC through a separate secure channel. Never upload the key beside the archive,
put it in Git, paste it into an issue, or reuse an application password as the
key.

## Install the archive dependency

```powershell
python -m pip install pyzipper
```

## Verify and extract

```powershell
python scripts/access-vault.py verify --archive access.zip `
  --key-file C:\secure\access-vault.key

python scripts/access-vault.py extract --archive access.zip `
  --key-file C:\secure\access-vault.key `
  --destination C:\secure\seemplify-access
```

## Rebuild after editing `access/`

```powershell
python scripts/access-vault.py pack --source access --archive access.zip `
  --key-file C:\Users\Michael\.seemplify\access-vault.key
```

Run verification again, update `access.zip.sha256`, and secret-scan the staged
text changes before pushing. AES ZIP member names remain visible by design, but
member contents must not be readable without the unlock key.

## Existing exposure

The former `access.zip` was readable in this public repository. Replacing the
current file does not remove the old blob from Git history. Treat credentials
from the former archive as exposed: rotate them, then separately approve and
coordinate a repository-history rewrite and force-push.
