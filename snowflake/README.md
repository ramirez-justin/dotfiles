# Snowflake

Snowflake CLI connection templates for local setup.

The real connection file lives at `~/.snowflake/connections.toml` and is not
committed because it contains machine-local auth details and private key paths.
This topic only tracks a safe example file.

## Connections

Recommended local connections:

- `default`: JWT/key-pair auth for automation, Pi, and scripts.
- `gametime_jwt`: explicit alias for the same JWT/key-pair auth.
- `gametime_okta`: browser-based Okta SSO for interactive use.

## Setup

Install the CLI from the Brewfile, then copy the example and adjust local paths:

```bash
mkdir -p ~/.snowflake
cp ~/.snowflake/connections.toml.example ~/.snowflake/connections.toml
chmod 600 ~/.snowflake/connections.toml
```

Verify both auth paths:

```bash
snow connection test -c default
snow sql -c default -q "select current_user(), current_role(), current_warehouse();"
snow connection test -c gametime_okta
```

Do not commit the real `connections.toml` or private key material.
