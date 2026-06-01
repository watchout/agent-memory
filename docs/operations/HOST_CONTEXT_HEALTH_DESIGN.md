# Host Context Health Design

> Status: host-specific operations design
> Authority: `docs/design/core/SSOT-6_LIVING_MEMORY_CONTROL.md`

---

## 1. Purpose

Host context health is observed by deterministic host, runner, hook, launcher,
or supervisor code when available. It is not primarily an LLM prompt decision.

Wasurezu may interpret host-provided metrics and semantic signals, but metric
provenance must be explicit.

---

## 2. Metric Sources

| Source | Trust level | Rule |
|--------|-------------|------|
| Host/runtime token-window metrics | measured | May drive `prepare`, `warn`, `recommend`, or `require` bands. |
| Supervisor/AUN context health signal | measured or delegated | May drive lifecycle recommendation for the owning supervisor. |
| Wasurezu semantic sparse-pack signal | estimated | May recommend recovery but must be labeled estimated. |
| LLM self-report inside prompt | soft | Fallback signal only; not sufficient for normal automation. |

---

## 3. Bands

Use the typed lifecycle bands from `SSOT-6`:

- `ok`
- `prepare`
- `warn`
- `recommend`
- `require`
- `pack_only`
- `on_demand`
- `off`

When metrics are absent, Wasurezu must not pretend to know actual context
percentage. It may use semantic degradation and sparse-memory evidence as
estimated signals.

---

## 4. Restart Markers

Restart markers should be written as structured lifecycle events or checkpoint
metadata. They should include:

- session id
- project
- host
- owner
- reason
- band
- pack id, when available
- confidence and missing context, when available

Markers must not require a live TUI prompt to become authoritative.
