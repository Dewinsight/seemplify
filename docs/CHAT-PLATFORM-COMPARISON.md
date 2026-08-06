# Chat platform comparison (single-domain + multi-org + OIDC + ease of deployment)

## What you asked for

You want a chat solution that:

- **Supports multiple organizations (tenants/workspaces)** aligned with your IDP orgs/members
- Works on a **single domain** (no wildcard / per-org subdomains)
- Integrates cleanly with your **OIDC IDP**
- Is preferably **open source**
- Is **easy to deploy/operate** (important factor)

## Definitions (so “multi-org” is not confused)

- **Multi-org / multi-tenant (what you want)**: one deployment, many isolated workspaces/orgs with access control that maps cleanly to your IDP org membership.
- **Multi-community / multi-server (Discord-style)**: one deployment can host many “servers”, but it’s not automatically tied to your IDP org model; SSO mapping and org provisioning may be manual/custom.

## Options compared (including Stoat + Matrix/Element)

### Quick comparison table

Scores are **relative** and practical for your constraints (5 = best).

| Option | Open source? | OIDC/SSO with your IDP | Multi-org model fit | Single-domain friendly | Ease of deployment | Notes |
|---|---:|---:|---:|---:|---:|---|
| **Matrix (Synapse) + Element (web/app)** | Yes (core) | Yes (via Synapse OIDC) | **Strong** (rooms/spaces + policy; org modeling is flexible) | **Yes** (no wildcard required) | 3/5 | Two components (server+client), but very standard; lots of deployment guides. |
| **Stoat (formerly Revolt)** | Yes (AGPL) | **Unclear / not first-class** | Medium (multi-community, not IDP-org-native) | Yes | 4/5 | Great “single stack” deploy; but SSO + org mapping likely needs custom work. |
| **Twake (old repo)** | Yes (AGPL) | Yes (OpenID/Keycloak docs) | Medium | Yes | 2/5 | The repo is **deprecated**; migration recommended. |
| **Twake Workplace (new direction)** | Mixed (ecosystem) | Varies | Varies | Varies | 2/5 | “Twake Chat” points to a Matrix-based client/server, so it stops being “one thing”. |
| **Mattermost** | Partly | **OIDC is paid-tier** | Strong | Yes | 4/5 | Great product, but OIDC not in OSS edition per docs. |
| **Discourse + Chat** | Partly | OIDC exists but plugin repo archived / plans-gated | Weak-to-medium | Yes | 3/5 | Discourse is a forum-first product; “multi-tenant” is typically separate instances. |
| **Zulip** | Yes (Apache) | Yes | Medium (multi-realm exists) | **Usually painful** (often wants subdomain patterns) | 2/5 | You already saw how routing + realm isolation gets complex and heavy. |
| **Huly** | Source-available / mixed | Unclear/varies | Medium | Yes | 2/5 | Heavy footprint (you explicitly wanted lighter). Not a “chat-first” tool. |

## Key evidence / links (so this doc stays grounded)

### Stoat / Revolt

- Self-hosted “full instance” compose stack: [`stoatchat/self-hosted`](https://github.com/stoatchat/self-hosted)
- Backend license is **AGPL-3.0** (with exceptions per crate): [`stoatchat/stoatchat` LICENSE](https://raw.githubusercontent.com/stoatchat/stoatchat/main/LICENSE)
- Web client license is **AGPL-3.0**: [`stoatchat/for-web` LICENSE](https://raw.githubusercontent.com/stoatchat/for-web/main/LICENSE)
- “Auth servers / OpenID/OAuth2 ideas” discussed as a feature direction (not a clean “turnkey OIDC” doc): [discussion #103](https://github.com/revoltchat/revolt/discussions/103)

### Matrix / Element

- Matrix website: [matrix.org](https://matrix.org/)
- Matrix GitHub org: [github.com/matrix-org](https://github.com/matrix-org)
- Synapse (homeserver): [github.com/element-hq/synapse](https://github.com/element-hq/synapse)
- Element Web (client): [github.com/element-hq/element-web](https://github.com/element-hq/element-web)
- Matrix spec: [spec.matrix.org](https://spec.matrix.org/)

### Mattermost (OIDC availability)

- OIDC SSO docs (note the plan requirement): [OpenID Connect SSO](https://docs.mattermost.com/onboard/sso-openidconnect.html)
- Editions/offerings: [Mattermost editions](https://docs.mattermost.com/about/editions-and-offerings.html)

### Twake

- Twake auth modes mention OpenID: [Twake authentication modes](https://doc.twake.app/gettingstarted/configuration/authentication-modes)
- Keycloak/OpenID setup guide: [Twake + Keycloak OpenID](https://doc.twake.app/gettingstarted/configuration/authentication-modes/using-keycloak-ldap-openid-and-more)
- Deprecated repo notice + pointer to new repo: [linagora/Twake](https://github.com/linagora/Twake)
- New “Twake Workplace” hub repo: [linagora/twake-workplace](https://github.com/linagora/twake-workplace)

## Recommendation

### Best overall (given your constraints): **Matrix (Synapse) + Element**

It’s the best fit because:

- **OIDC is a normal, supported integration path** for the homeserver side (where auth belongs).
- **Single domain is normal** (no wildcard requirement).
- “Multi-org” can be modeled cleanly using **spaces/rooms + access rules**, and you can align membership with your IDP groups/claims (without fighting DNS/routing).
- It’s widely deployed, actively maintained, and has a large ecosystem.

Tradeoff:

- It is **not literally “one thing”**: you run a homeserver + a client (often two containers/apps).
  - In practice it’s still simpler than systems that fight your single-domain multi-org requirement at the routing layer.

### Best “single app you deploy” (but with major caveats): **Stoat**

Stoat looks attractive if your top priority is “deploy one stack and it works”:

- The `self-hosted` repo is designed for **one-shot deployment** ([`stoatchat/self-hosted`](https://github.com/stoatchat/self-hosted)).

But it’s **not the best option for you** because:

- Turnkey **OIDC/SSO with your IDP** + **org-to-workspace mapping** is not clearly a built-in, stable capability today (at least from public docs; it appears more “feature direction” than a straightforward admin setting) ([discussion #103](https://github.com/revoltchat/revolt/discussions/103)).
- Its multi-org story is more “many communities” than “multi-tenant enterprise workspaces mapped to an IdP”.

## Deployment complexity notes (realistic)

- **Matrix+Element**: medium complexity, but very standard; most of the work is configuring the homeserver + SSO + storage + backups.
- **Stoat**: easy to bring up, but if you need true org isolation via your IDP, complexity shifts into **custom auth/provisioning** work.
- **Zulip**: operationally heavy; multi-org and single-domain constraints tend to surface as routing/realm edge cases (you’ve already hit this).
- **Mattermost/Discourse**: can be easy to deploy, but you get blocked by licensing/plan gating for OIDC (Mattermost) or less ideal product fit (Discourse).

## Bottom line

- If you want **the best fit** for **OIDC + single domain + multi-org**: **Matrix (Synapse) + Element**.
- If you want **one deployable chat stack** and can accept **custom work for SSO/org mapping**: **Stoat** is the most promising “single thing”, but it’s not turnkey for your exact model.

