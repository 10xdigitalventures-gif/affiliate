# Accessibility (WCAG 2.1 AA)

## Target conformance level

**WCAG 2.1 Level AA** for all customer-facing pages:
- Merchant dashboard
- Affiliate portal
- Public signup embed
- Marketing / landing pages

## Automated checks

Every PR that touches `web/` is audited by `axe-core` in CI
(`.github/workflows/a11y.yml`). The job fails if any **critical** or
**serious** violations are detected.

## Manual testing checklist

- [ ] Keyboard navigation: all interactive elements reachable with Tab
- [ ] Screen reader: tested with VoiceOver (macOS) and NVDA (Windows)
- [ ] Colour contrast: minimum 4.5:1 for body text, 3:1 for large text
- [ ] Focus indicators: visible on all interactive elements
- [ ] Images: all non-decorative images have descriptive `alt` text
- [ ] Forms: every field has an associated `<label>` or `aria-label`
- [ ] Error messages: errors identified by text, not colour alone
- [ ] Motion: honours `prefers-reduced-motion`

## Known exceptions

| Page / component | Issue | Justification |
|-----------------|-------|---------------|
| Chart tooltips | axe colour contrast | Third-party chart library; scheduled for replacement |

## Resources

- [WCAG 2.1 quick reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [axe-core rules](https://dequeuniversity.com/rules/axe/)
- [Radix UI accessibility docs](https://www.radix-ui.com/primitives/docs/overview/accessibility)
