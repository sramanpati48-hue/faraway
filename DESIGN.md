# Design system — NyaySahayak

<!-- impeccable:design-schema 1 -->

## Platform

Web — extends existing application tokens; marketing landing at `/` uses the same palette.

## Color strategy

**Restrained:** white and `#F8F9FA` grounds, `#00634B` primary accent, slate neutrals. Amber only for urgent/help contexts inside the app.

## Typography

| Role | Face |
|------|------|
| Editorial headlines, section titles, final CTA | Instrument Serif |
| UI, body, nav, buttons, cards, FAQ, footer | DM Sans |

## Components

- Border: `border-slate-200/80`, hairline dividers
- Radius: `rounded-lg` / `rounded-xl` (stepped down from earlier app surfaces)
- Shadow: soft, offset — `shadow-sm`, `shadow-md` on hover; no colored halos
- Motion: Framer Motion fade/slide/stagger; one hero moment; scroll reveals sparingly

## Landing (`/`)

**Mode:** Persuade — calm trust, reduce anxiety, primary action is signup/start.

**Content IA (2026-07):** Hero → trust (defensible) → problem/promise → how-it-works (7-step ladder) → situations → specialist AI → human help (+ Gram Nyayalaya) → continuity → Clash (supporting) → privacy → helplines → honest proof → comparison → FAQ → final CTA. Public `/privacy` and `/terms` required for trust claims.

**Anti-patterns for this surface:** gradient text, neumorphism, glass decoration, aggressive marketing, government-portal density, gradient overload, vanity metrics, blanket “human verified” certification language.

## App workspace

Victim shell (`/home`, `/cases`) inherits tokens above; sidebar uses DM Sans with Instrument Serif for wordmark and section labels only.
