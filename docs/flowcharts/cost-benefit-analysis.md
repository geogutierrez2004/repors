# Cost Benefit Analysis

## Executive Summary
The filing system already reduces manual document handling through encrypted storage, audit logging, backup and restore, and secure previews. Adding configurable security thresholds makes the Security tab actionable instead of decorative: operators can tune alert levels for storage risk and upload failure spikes to match local policy, reduce noise, and surface problems earlier.

The business case is strongest when the organization has one or more of the following conditions:
1. Storage usage changes quickly over time.
2. Upload failures are operationally disruptive.
3. Staff need clear warning/danger signals instead of raw counts.
4. Review or compliance evidence must show that risk thresholds are deliberate and adjustable.

## Decision Statement
Fund the threshold settings feature if the goal is to reduce risk detection lag and improve operator response quality with minimal recurring cost. The implementation is low to moderate complexity, reuses existing storage and activity telemetry, and creates a configurable control layer without requiring a separate admin system.

## Scope of Analysis
1. Core platform operation: upload, download, preview, organization, audit.
2. Security integrity monitoring: storage risk, failed uploads, backup freshness, auth threat activity.
3. Configurable threshold settings for severity levels in the Security tab.

## Value Drivers
### 1. Operational Continuity
1. Warn before storage exhaustion interrupts uploads.
2. Distinguish minor noise from real issue clusters.
3. Reduce time spent interpreting charts manually.

### 2. Security Response
1. Surface upload failure spikes earlier.
2. Make risk trends visible in the dashboard instead of buried in logs.
3. Allow policy-driven alert tuning without code changes.

### 3. Governance and Accountability
1. Provide a documented threshold policy.
2. Keep severity boundaries auditable.
3. Support periodic review of risk controls.

## Cost Components
### 1. One-Time Development Cost
1. Threshold model, IPC, and persistence work.
2. Security dashboard UI controls and validation.
3. Documentation and diagram updates.
4. QA for edge cases and persistence.

### 2. Ongoing Operational Cost
1. Periodic tuning of thresholds.
2. Support for interpreting warnings and danger states.
3. Maintenance of defaults as usage patterns change.

### 3. Risk Cost
1. False positives if thresholds are too aggressive.
2. Delayed alerts if thresholds are too lenient.
3. Misconfiguration if settings are changed without policy review.

## Benefit Components
### 1. Measurable Benefits
1. Fewer storage-related upload interruptions.
2. Faster response to failure spikes.
3. Earlier warning before storage reaches critical capacity.

### 2. Qualitative Benefits
1. Better operational confidence.
2. Clearer dashboard interpretation for non-technical staff.
3. Less ambiguity in security reviews.

### 3. Governance Benefits
1. Thresholds can be documented as policy artifacts.
2. Severity boundaries can be reviewed quarterly.
3. Operational decisions become easier to justify.

## Assumptions
The appendix below is intentionally model-driven. Replace sample values with site-specific data if available.

| Assumption | Example Value | Notes |
|---|---:|---|
| Admin review time per alert | 15 minutes | Time spent triaging and validating a warning |
| Hourly admin cost | 25 units/hour | Substitute local labor cost |
| Upload outage impact per event | 1 to 3 hours equivalent | Lost work, delay, or reprocessing |
| Failed upload spike frequency | 2 per quarter | Example baseline before threshold tuning |
| Storage-critical event frequency | 1 per quarter | Example baseline when monitoring is manual |
| Review cadence | Quarterly | Recommended threshold tuning cycle |

## Simple ROI Model
Use the following model to estimate annual value.

### Annual Benefit
`annual_benefit = avoided_incident_cost + reduced_triage_time_savings + avoided_outage_cost`

Where:
1. `avoided_incident_cost` = (incidents avoided per year) × (cost per incident)
2. `reduced_triage_time_savings` = (alerts reduced or clarified per year) × (minutes saved per alert) × (hourly cost / 60)
3. `avoided_outage_cost` = (outages avoided per year) × (cost per outage)

### Annual Cost
`annual_cost = development_amortized + support_cost + tuning_cost`

Where:
1. `development_amortized` = one-time implementation cost spread over expected service life.
2. `support_cost` = training and help-desk cost.
3. `tuning_cost` = periodic review and adjustment time.

### Net Benefit
`net_benefit = annual_benefit - annual_cost`

### Payback Period
`payback_period_years = one_time_cost / annual_benefit`

## Scenario Analysis
### 1. Conservative Scenario
1. Lower alert noise.
2. Slightly delayed warnings.
3. Best when staff time is scarce and false positives are costly.

### 2. Balanced Scenario
1. Moderate alert sensitivity.
2. Good trade-off between early warning and noise.
3. Best default for most deployments.

### 3. Aggressive Scenario
1. Earlier warnings.
2. More operator attention required.
3. Best when availability is more important than alert fatigue.

| Scenario | Expected Benefit | Expected Cost | Risk Profile |
|---|---:|---:|---|
| Conservative | Medium | Low | Lower noise, slower detection |
| Balanced | High | Medium | Best overall trade-off |
| Aggressive | Medium | Medium-High | Faster detection, more false alerts |

## Implementation Cost Estimate Template
Use this section as a planning template rather than a fixed claim.

| Task | Estimated Effort | Notes |
|---|---:|---|
| Threshold settings backend | 1 to 2 days | IPC, storage, validation |
| Security dashboard UI | 1 to 2 days | Settings panel + tone logic |
| Flowchart/documentation updates | 0.5 to 1 day | Diagrams and markdown docs |
| QA and refinement | 1 day | Build validation and edge cases |

## KPI Mapping
| KPI | What It Shows | Why It Matters |
|---|---|---|
| Mean time to detect storage risk increase | Time from trend onset to operator awareness | Shows whether thresholds are useful |
| Failed upload spikes caught at warning stage | Early warning effectiveness | Indicates whether tuning is preventing incidents |
| Incidents reaching danger stage without warning | Missed detection rate | Measures threshold weakness |
| False-alert rate | Operational noise | Measures whether thresholds need tuning |
| User-reported actionability | Usability of dashboard signals | Shows whether the dashboard is actually helpful |

## Recommendation
Adopt the threshold settings feature and use balanced defaults as the baseline. Review values quarterly, then tune them using actual storage usage and failed upload trends. The feature is justified if it prevents even a small number of storage-related disruptions or reduces the time spent triaging noisy alerts.

## Decision Gate
Proceed if:
1. Storage warning and danger levels are defined.
2. Upload-failure thresholds reflect local tolerance.
3. A quarterly review owner is assigned.

Hold or recalibrate if:
1. Thresholds create excessive false alerts.
2. Operators do not trust the severity states.
3. The organization cannot commit to periodic review.

## Review Notes
1. Replace sample values with local data when available.
2. Re-run the model after the first quarter of usage.
3. Use the Security tab KPIs to validate whether the thresholds are improving decisions.
