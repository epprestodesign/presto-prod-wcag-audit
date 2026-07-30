// Remediation library: one entry per rule, keyed by axe rule id or the id used
// by capture/analyze.mjs.
//
// Fixes are written against the two stacks this journey actually runs on:
//
//   presto.eventpipe.com   Vue 3 + Quasar SPA   (search, hotel detail)
//   app.eventpipe.com      server-rendered form (checkout, manage booking)
//
// `before` snippets are taken from the captured production markup, trimmed for
// readability. Anything shortened is marked with an ellipsis comment.

export const FIXES = {
  // ---------------------------------------------------------------------------
  'timing-adjustable': {
    title: 'Give the user control over the checkout time limit',
    effort: 'M',
    owner: 'app.eventpipe.com (checkout)',
    why:
      'A time limit is only permitted under WCAG 2.2.1 if the user can turn it off, adjust it to at least ' +
      'ten times the default, or extend it by a simple action after being warned. Offering none of the three ' +
      'is a Level A failure. The practical harm is severe here: the timer spans a four-step form collecting ' +
      'names, org, team, payment and policy consent. A screen-reader user, a switch user, or anyone reading ' +
      'carefully can exceed 15 minutes and silently lose the reservation.',
    before: `<!-- Countdown runs down and the order is dropped. No control offered. -->
<div class="reservation-timer">
  <span>Reserve before time runs out!</span>
  <span class="time-remaining">Time remaining: 14:54</span>
</div>`,
    after: `<!-- Minimum compliant change: warn before expiry and let the user extend.
     The "Extend" button satisfies 2.2.1's "extend with a simple action". -->
<div class="reservation-timer">
  <span id="timer-label">Reserve before time runs out!</span>

  <!-- role="timer" + aria-live="off" keeps SRs from announcing every tick -->
  <span class="time-remaining" role="timer" aria-live="off"
        aria-labelledby="timer-label">Time remaining: 14:54</span>
</div>

<!-- Warning surfaces at T-2:00. assertive: the user must hear it in time. -->
<div class="timer-warning" role="alertdialog" aria-live="assertive"
     aria-labelledby="warn-title" hidden>
  <h2 id="warn-title">Your reservation hold expires in 2 minutes</h2>
  <button type="button" id="extend-hold">Give me 20 more minutes</button>
  <button type="button" id="dismiss-warning">Continue without extending</button>
</div>`,
    notes: [
      'Server must honour the extension — a client-only timer change just moves the failure.',
      'Announce with aria-live="assertive" only for the warning, never for each tick: a per-second live region makes the form unusable with a screen reader.',
      'Best fix is to remove the visible countdown entirely for logged-in users and hold inventory server-side, keeping the timer as a silent backstop.',
      'If the limit is essential for inventory integrity, WCAG has a "Real-time Exception" — but it does not apply here, because a hotel hold is not a real-time event like an auction.',
    ],
  },

  // ---------------------------------------------------------------------------
  'unlabelled-controls': {
    title: 'Give every form control a real, programmatic label',
    effort: 'S',
    owner: 'both',
    why:
      'These controls are identified only by placeholder text or by nearby visual text. A placeholder is not ' +
      'an accessible name: it is not reliably announced, it fails contrast at its default grey, and it ' +
      'disappears the moment the user types — removing the only cue to what the field was for. Users who ' +
      'navigate a form field-by-field with a screen reader hear "edit, blank".',
    before: `<!-- checkout step 1: label is a sibling div, not associated -->
<div class="field-label">Team Name <span class="req">*</span></div>
<input type="text" name="Rooms[0].TeamName" placeholder="i.e. All-Stars 12U Team">`,
    after: `<!-- Associate explicitly. The for/id pair is what makes the text a *name*. -->
<label for="team-name">
  Team Name
  <!-- asterisk hidden from AT; the required attribute already conveys it -->
  <span class="req" aria-hidden="true">*</span>
</label>
<input type="text"
       id="team-name"
       name="Rooms[0].TeamName"
       required
       aria-required="true"
       placeholder="i.e. All-Stars 12U Team">`,
    quasar: `<!-- Vue/Quasar side: q-input renders the association for you.
     Never replace :label with a bare placeholder. -->
<q-input
  v-model="teamName"
  label="Team Name"
  :rules="[val => !!val || 'Team name is required']"
  hint="i.e. All-Stars 12U Team"
/>

<!-- If a design truly forbids a visible label, name it explicitly — but a
     visible label is preferred: it also serves users with cognitive load. -->
<q-input v-model="query" aria-label="Search by property name" />`,
    notes: [
      'Production ids here are order-scoped (`Rooms[0].Guests[0].FirstName`). Reuse that exact string as the id so for/id stays unique when a second guest row is added.',
      'Do not point `for` at a wrapper div — it must reference the control itself.',
    ],
  },

  // ---------------------------------------------------------------------------
  'select-name': {
    title: 'Name the select, and stop using a paragraph as its label',
    effort: 'S',
    owner: 'app.eventpipe.com (checkout)',
    why:
      'The SMS-consent select has no programmatic name, and its visible label is a ~300-character legal ' +
      'paragraph. A screen reader announces the entire paragraph before the user reaches the options, every ' +
      'time focus enters the control. The consent text is necessary — but it is a description, not a name.',
    before: `<!-- The whole consent paragraph is the visible label, and the select
     itself has no accessible name at all. -->
<div class="consent-text">
  By selecting yes, you agree to receive text messages at the number provided.
  Message frequency may vary. Standard message and data rates may apply.
  Text HELP for help. Text STOP to cancel. *
</div>
<select name="Rooms[0].CustomFieldValues[0].FieldValue">
  <option value="">Select By selecting yes, you agree to receive text messages…</option>
  <option>Yes</option>
  <option>No</option>
</select>`,
    after: `<!-- Short name via <label>, long legalese via aria-describedby.
     SRs announce the name first, then the description — so the user knows
     what the control *is* before hearing the terms. -->
<label for="sms-consent">Receive text message updates</label>

<p id="sms-consent-terms" class="consent-text">
  By selecting yes, you agree to receive text messages at the number provided.
  Message frequency may vary. Standard message and data rates may apply.
  Text HELP for help. Text STOP to cancel.
</p>

<select id="sms-consent"
        name="Rooms[0].CustomFieldValues[0].FieldValue"
        required
        aria-required="true"
        aria-describedby="sms-consent-terms">
  <option value="">Select an option</option>
  <option value="yes">Yes</option>
  <option value="no">No</option>
</select>`,
    notes: [
      'Also fixes the placeholder option, which currently repeats the entire paragraph as option text.',
    ],
  },

  // ---------------------------------------------------------------------------
  'button-name': {
    title: 'Name icon-only buttons',
    effort: 'S',
    owner: 'presto.eventpipe.com (Vue/Quasar)',
    why:
      'These buttons contain only an icon glyph, so their accessible name resolves to the ligature text ' +
      '("arrow_drop_down", "search") or to nothing. A screen reader announces "button" with no indication of ' +
      'what it does. This is the single largest critical-impact count in the audit, driven by the carousel ' +
      'arrows repeated on every hotel card.',
    before: `<!-- Material icon ligature becomes the accessible name -->
<button class="q-btn">
  <i class="material-icons">arrow_left</i>
</button>`,
    after: `<!-- aria-label names the control; aria-hidden stops the ligature
     text from being announced alongside it. -->
<button class="q-btn" aria-label="Previous photo">
  <i class="material-icons" aria-hidden="true">arrow_left</i>
</button>`,
    quasar: `<!-- Quasar: q-btn with :icon still needs a name. -->
<q-btn icon="arrow_left" aria-label="Previous photo" flat round />

<!-- Better for carousels: name the target, not the direction, so a user
     hearing 40 identical "Previous photo" buttons can tell them apart. -->
<q-btn
  icon="arrow_left"
  :aria-label="\`Previous photo of \${hotel.name}\`"
  flat round
/>`,
    notes: [
      'The carousel arrows repeat once per hotel card — 80 nodes on the desktop search page alone. Fixing the shared card component clears most of the count in one change.',
      'If the control is genuinely decorative and duplicated by adjacent text, hide it instead: `aria-hidden="true" tabindex="-1"`.',
    ],
  },

  // ---------------------------------------------------------------------------
  'image-alt': {
    title: 'Give every image an alt attribute — empty for decorative ones',
    effort: 'S',
    owner: 'both',
    why:
      'A missing alt attribute is not equivalent to alt="". With no attribute, screen readers fall back to ' +
      'announcing the filename — which here is a GUID like "55d2ba04-bf6b-4bc1-81bc-736fd46eeb0d.png". ' +
      'Decorative images need an explicit empty alt so they are skipped.',
    before: `<img src="https://storage.googleapis.com/eventpipe/55d2ba04-….png">`,
    after: `<!-- Meaningful: describe the content's purpose, not its appearance. -->
<img src="https://storage.googleapis.com/eventpipe/55d2ba04-….png"
     alt="Spark by Hilton Exton exterior">

<!-- Decorative / redundant with adjacent text: empty alt, explicitly. -->
<img src="…/sponsor-band.png" alt="">

<!-- Vue: bind it, and keep a fallback so a missing field never means no attr. -->
<img :src="hotel.photoUrl" :alt="hotel.photoAlt || \`\${hotel.name} exterior\`">`,
    notes: [
      'Hotel photos are content: they inform the choice, so they need descriptive alt.',
      'The event hero is a background-image, so it needs no alt — but the white title text over it must still meet 1.4.3 contrast against the photo.',
      'Sponsor/promo images that link somewhere must describe the destination, not the artwork.',
    ],
  },

  // ---------------------------------------------------------------------------
  'color-contrast': {
    title: 'Raise text contrast to 4.5:1 (3:1 for large text)',
    effort: 'M',
    owner: 'both',
    why:
      'The largest single count in the audit. Failing text is mostly grey-on-white secondary copy, ' +
      'placeholder text, and white text on light brand fills. At typical mobile brightness this is the ' +
      'difference between readable and invisible for users with low vision — and for everyone outdoors.',
    before: `/* Placeholder and secondary text below 4.5:1 on white */
.text-grey-6      { color: #9e9e9e; }   /* 2.85:1 on #fff — fails */
input::placeholder{ color: #a8a8a8; }   /* 2.54:1 on #fff — fails */`,
    after: `/* Darkened to clear 4.5:1 on white. Values chosen to stay within the
   existing grey ramp so the visual design is preserved. */
.text-grey-6      { color: #6b6b6b; }   /* 4.62:1 — passes AA  */
input::placeholder{ color: #666666; }   /* 5.05:1 — passes AA  */

/* Large text (>=24px, or >=18.66px bold) may use 3:1 */
.hero-subtitle    { color: #767676; }   /* 4.54:1 — passes at any size */`,
    notes: [
      'Check the fix against the real background, not white — several failures sit on the #f9f9fa page fill, which needs slightly darker text than pure white does.',
      'The white-on-photo hero title cannot be fixed with a colour change alone: add a scrim (e.g. `background: linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45))`) so contrast is guaranteed regardless of which event image is uploaded.',
      'Disabled controls are exempt from 1.4.3, so filter those out before triaging the raw count.',
    ],
  },

  // ---------------------------------------------------------------------------
  'no-headings': {
    title: 'Introduce a real heading outline',
    effort: 'M',
    owner: 'presto.eventpipe.com (Vue/Quasar)',
    why:
      'The search, hotel detail and lookup pages contain no h1–h6 at all. Heading navigation is the primary ' +
      'way screen-reader users skim a page — the rotor / "H" key. With zero headings there is nothing to ' +
      'navigate by, so reaching the tenth hotel means listening through everything before it.',
    before: `<!-- Hotel name is styled text in a div — visually a heading, semantically nothing -->
<div class="hotel-name text-h6">Spark by Hilton Exton</div>`,
    after: `<!-- Same visual weight, real semantics. Quasar's text-h6 class is
     presentational and works on any element. -->
<h3 class="hotel-name text-h6">Spark by Hilton Exton</h3>`,
    quasar: `<!-- Recommended outline for the search page -->
<h1 class="sr-only">Hotels for 2026 - Fall Continental Cup</h1>

<h2 class="sr-only">Search and filters</h2>
  <h3>Search by Property Name</h3>
  <h3>Amenities</h3>
  <h3>Search Radius</h3>

<h2 class="sr-only">Results — 24 hotels</h2>
  <h3>Spark by Hilton Exton</h3>       <!-- one per result card -->

<!-- .sr-only: available to AT, invisible on screen. -->
<style>
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
</style>`,
    notes: [
      'Do not choose heading level by how big the text looks — level expresses nesting. Style separately.',
      'One h1 per page, naming what the page is for.',
      'Result-card headings should be the hotel name: that is what users search for by rotor.',
    ],
  },

  // ---------------------------------------------------------------------------
  'missing-landmarks': {
    title: 'Wrap the page in landmark regions',
    effort: 'S',
    owner: 'both',
    why:
      'Only a <footer> exists site-wide. Landmarks let assistive-tech users jump between regions — without ' +
      '<main>, there is no way to skip the header, hero and filter rail and land on the results.',
    before: `<div id="app">
  <div class="header">…</div>
  <div class="filters">…</div>
  <div class="results">…</div>
  <footer>…</footer>
</div>`,
    after: `<div id="app">
  <header role="banner">
    <nav aria-label="Primary">…</nav>
  </header>

  <!-- The single most valuable addition: a jump target for the results -->
  <main id="main-content">
    <!-- Two search regions on one page must be told apart by name -->
    <search aria-label="Hotel filters">…</search>
    <section aria-label="Search results">…</section>
  </main>

  <footer role="contentinfo">…</footer>
</div>`,
    notes: [
      'Exactly one <main> per page.',
      'Name repeated landmarks (`aria-label`) — two unnamed <nav>s are indistinguishable in a landmark list.',
      '<search> is the HTML element for a search region; `role="search"` is the fallback for older AT.',
    ],
  },

  // ---------------------------------------------------------------------------
  'no-skip-link': {
    title: 'Add a skip link',
    effort: 'S',
    owner: 'both',
    why:
      'A keyboard user faces 215 tab stops in source order on the desktop search page, with no way to bypass ' +
      'the header and filter rail. WCAG 2.4.1 is Level A and is satisfied by either a skip link or landmarks; ' +
      'this journey currently has neither.',
    before: `<!-- nothing precedes the header in tab order -->
<header>…</header>`,
    after: `<!-- First focusable element on the page. Visually hidden until focused,
     so it costs the visual design nothing. -->
<a class="skip-link" href="#main-content">Skip to search results</a>

<header>…</header>
<main id="main-content" tabindex="-1">…</main>

<style>
.skip-link {
  position: absolute;
  top: -100px;         /* off-screen, but still focusable */
  left: 8px;
  z-index: 10000;
  padding: 12px 20px;
  background: #14203c;
  color: #fff;
  border-radius: 0 0 6px 6px;
  text-decoration: none;
  transition: top .15s ease-in;
}
.skip-link:focus { top: 0; }   /* slides into view on keyboard focus */
</style>`,
    notes: [
      '`tabindex="-1"` on the target makes the jump actually move focus in Safari and Chrome; without it the link scrolls but focus stays behind.',
      'Never hide it with `display:none` or `visibility:hidden` — that removes it from the tab order and defeats the purpose.',
    ],
  },

  // ---------------------------------------------------------------------------
  'focus-appearance': {
    title: 'Restore a focus indicator that meets 2.4.11',
    effort: 'S',
    owner: 'presto.eventpipe.com (Vue/Quasar)',
    why:
      'Quasar ships a focus affordance; production disables it (`.q-focus-helper { display: none }`) and ' +
      'zeroes the native outline, leaving a 1px dashed text underline as the only indicator. That is below ' +
      "WCAG 2.2's minimum focus-appearance area, and it does nothing at all for icon-only controls, which " +
      'have no text to underline.',
    before: `/* Production stylesheet */
.q-focus-helper,
.q-color-picker .q-tab__indicator { display: none; }

.q-focus-helper, .q-focusable,
.q-manual-focusable, .q-hoverable { outline: 0; }

:focus-visible { text-decoration: underline 1px dashed; }`,
    after: `/* Remove the two suppressions above, then define one indicator that
   works on text and icon controls alike.

   2.4.11 wants at least the area of a 2px perimeter, at >=3:1 against the
   unfocused state. A 2px outline plus a contrasting offset ring satisfies it
   on both light and dark surfaces. */
:focus-visible {
  outline: 2px solid #14203c;   /* brand navy — 12.6:1 on white */
  outline-offset: 2px;
  border-radius: 2px;
}

/* White ring so the indicator survives on dark/photo backgrounds */
.on-dark :focus-visible,
.hero :focus-visible {
  outline-color: #ffffff;
  box-shadow: 0 0 0 4px rgba(0, 0, 0, .55);
}

/* Keep mouse users' experience unchanged — :focus-visible already does this,
   so no :focus rule is needed and none should be suppressed. */`,
    notes: [
      'Do not reintroduce a blanket `outline: 0`. If a component needs a custom ring, style `:focus-visible` on that component rather than removing it globally.',
      "Deleting `.q-focus-helper { display: none }` restores Quasar's built-in ripple-style focus on q-btn and q-item for free.",
    ],
  },

  // ---------------------------------------------------------------------------
  'target-size': {
    title: 'Meet the 24x24 minimum pointer target',
    effort: 'M',
    owner: 'both',
    why:
      'WCAG 2.2 requires pointer targets be at least 24x24 CSS pixels unless adequately spaced or duplicated ' +
      'elsewhere. Undersized targets are hardest for users with tremor or limited dexterity, and on touch ' +
      'screens for everyone. The failures here are mostly star ratings, carousel dots and inline text links ' +
      'sitting in dense rows.',
    before: `.rating-star  { width: 14px; height: 14px; }
.carousel-dot { width: 8px;  height: 8px;  }`,
    after: `/* Keep the glyph small; grow the hit area with padding so the visual
   design is untouched. */
.rating-star {
  width: 14px; height: 14px;
  padding: 5px;                 /* 14 + 5 + 5 = 24 */
  box-sizing: content-box;
}

/* Where padding would break layout, use a pseudo-element to extend the
   target beyond the visible box. */
.carousel-dot {
  position: relative;
  width: 8px; height: 8px;
}
.carousel-dot::after {
  content: '';
  position: absolute;
  inset: -8px;                  /* 8 + 8 + 8 = 24 */
}`,
    notes: [
      'Non-interactive star ratings should not be focusable at all — if they only display a score, remove the tabindex and the criterion no longer applies.',
      'The "spacing" exception can satisfy 2.5.8 without resizing: if 24px circles centred on each target do not overlap, the target passes.',
    ],
  },

  // ---------------------------------------------------------------------------
  'missing-autocomplete': {
    title: 'Declare input purpose with autocomplete tokens',
    effort: 'S',
    owner: 'app.eventpipe.com (checkout)',
    why:
      'WCAG 1.3.5 requires inputs collecting information about the user to expose their purpose ' +
      'programmatically. Without it, browser autofill cannot help and assistive tech that substitutes ' +
      'familiar icons or simplified vocabulary cannot identify the field — a direct barrier for users with ' +
      'cognitive disabilities, and needless friction for everyone else.',
    before: `<input type="text" name="Rooms[0].Guests[0].FirstName">
<input type="text" name="Rooms[0].Guests[0].LastName">
<input type="text" name="Rooms[0].Guests[0].PhoneNumber">`,
    after: `<input type="text"  name="Rooms[0].Guests[0].FirstName"
       autocomplete="given-name">
<input type="text"  name="Rooms[0].Guests[0].LastName"
       autocomplete="family-name">
<!-- type="tel" also brings up the numeric keypad on mobile -->
<input type="tel"   name="Rooms[0].Guests[0].PhoneNumber"
       autocomplete="tel">

<!-- Payment step (same rule applies) -->
<input autocomplete="cc-name">    <input autocomplete="cc-number">
<input autocomplete="cc-exp">     <input autocomplete="cc-csc">
<input autocomplete="postal-code">`,
    notes: [
      'Only the primary guest is "the user" in 1.3.5 terms — additional-guest rows are about someone else, so `autocomplete` there should be off or section-scoped (`section-guest2 given-name`) to avoid autofilling the wrong person.',
    ],
  },

  // ---------------------------------------------------------------------------
  'aria-required-attr': {
    title: 'Convey "required" to assistive tech, not just with a red asterisk',
    effort: 'S',
    owner: 'app.eventpipe.com (checkout)',
    why:
      'Required fields are marked with a red "*" only. Colour alone is not an acceptable carrier of ' +
      'information (1.4.1), and the asterisk is not exposed as a required state, so a screen reader ' +
      'user learns a field was mandatory only after submitting and failing validation.',
    before: `<div class="field-label">Mobile Number <span class="req">*</span></div>
<input type="text" name="Rooms[0].Guests[0].PhoneNumber">`,
    after: `<label for="mobile">
  Mobile Number
  <span class="req" aria-hidden="true">*</span>
  <span class="sr-only">(required)</span>
</label>
<input type="tel"
       id="mobile"
       name="Rooms[0].Guests[0].PhoneNumber"
       required
       aria-required="true"
       autocomplete="tel">`,
    notes: [
      'The legend "All fields marked with * are required" is fine as a supplement, but it does not make the state programmatic.',
      'Native `required` also enables browser validation; `aria-required` covers AT that does not map the native attribute.',
    ],
  },

  // ---------------------------------------------------------------------------
  'aria-input-field-name': {
    title: 'Name custom ARIA widgets',
    effort: 'S',
    owner: 'presto.eventpipe.com (Vue/Quasar)',
    why:
      'Elements carrying an ARIA input role (combobox, spinbutton, slider) have no accessible name. Taking ' +
      'on the role means taking on the naming obligation — the native label association no longer applies.',
    before: `<div role="combobox" aria-expanded="false">
  <span>1 Traveler, 1 Room</span>
</div>`,
    after: `<div role="combobox"
     aria-expanded="false"
     aria-controls="occupancy-listbox"
     aria-label="Travellers and rooms">
  <span>1 Traveler, 1 Room</span>
</div>

<!-- The search radius slider needs name + current value -->
<div role="slider"
     aria-label="Search radius in miles"
     aria-valuemin="1" aria-valuemax="50" aria-valuenow="25"
     aria-valuetext="25 miles"
     tabindex="0"></div>`,
    notes: [
      'Prefer a native control over a custom role wherever the design allows — `<select>` and `<input type=range>` are named and operable for free.',
    ],
  },

  // ---------------------------------------------------------------------------
  label: {
    title: 'Associate the visible label with its control',
    effort: 'S',
    owner: 'both',
    why: 'axe reports controls whose visible label text exists but is not associated via for/id, aria-label or wrapping.',
    before: `<div class="label">Search by Property Name</div>
<input type="text" placeholder="e.g. Marriott">`,
    after: `<label for="property-search">Search by Property Name</label>
<input type="text" id="property-search" placeholder="e.g. Marriott">`,
    notes: ['See "unlabelled-controls" for the fuller treatment, including the Quasar form.'],
  },

  // ---------------------------------------------------------------------------
  'no-lang': {
    title: 'Declare the document language',
    effort: 'XS',
    owner: 'app.eventpipe.com (checkout)',
    why:
      'The checkout document has no lang attribute. Screen readers fall back to the user\'s default voice, ' +
      'so English content may be read with the pronunciation rules of another language — often unintelligible.',
    before: `<html>`,
    after: `<html lang="en">`,
    notes: [
      'The Vue SPA already sets lang="en"; only the server-rendered checkout is missing it.',
      'Mark any inline language change too: `<span lang="fr">…</span>`.',
    ],
  },

  // ---------------------------------------------------------------------------
  'img-no-alt-attr': {
    title: 'Add the missing alt attribute',
    effort: 'S',
    owner: 'both',
    why: 'Same defect as image-alt, reported from the DOM inventory: the attribute is absent entirely, so AT falls back to the GUID filename.',
    before: `<img src="…/55d2ba04-bf6b-4bc1-81bc-736fd46eeb0d.png">`,
    after: `<img src="…/55d2ba04-bf6b-4bc1-81bc-736fd46eeb0d.png" alt="">   <!-- decorative -->
<img src="…/hotel-exterior.png" alt="Spark by Hilton Exton exterior">  <!-- meaningful -->`,
    notes: ['Decide per image: does it carry information the surrounding text does not?'],
  },

  // ---------------------------------------------------------------------------
  'no-h1': {
    title: 'Add a level-1 heading',
    effort: 'XS',
    owner: 'both',
    why: 'Nothing names the page at the top of its outline, so AT users get no programmatic statement of what the page is.',
    before: `<div class="page-title">1. Guest Information</div>`,
    after: `<h1>Guest information for your reservation at Spark by Hilton Exton</h1>`,
    notes: ['Use .sr-only if the design has no room for a visible h1.'],
  },

  // ---------------------------------------------------------------------------
  'heading-skip': {
    title: 'Do not skip heading ranks',
    effort: 'XS',
    owner: 'app.eventpipe.com (checkout)',
    why: 'A jump from h2 to h4 implies a nesting level that does not exist, misrepresenting the outline.',
    before: `<h2>1. Guest Information</h2>
  <h4>Two Queen Beds - Guest Room</h4>`,
    after: `<h2>1. Guest Information</h2>
  <h3 class="text-sm">Two Queen Beds - Guest Room</h3>`,
    notes: ['Pick the level from the structure, then style it to whatever size the design wants.'],
  },

  // ---------------------------------------------------------------------------
  'focus-not-visible': {
    title: 'Make these specific controls show focus',
    effort: 'S',
    owner: 'both',
    why:
      'Measured by tabbing to each control and diffing rendered pixels: these produced no perceptible change ' +
      'when focused. Most are third-party chat-widget controls and 1x1 proxy inputs behind styled Quasar ' +
      'components.',
    before: `<!-- 1x1 proxy input: a real tab stop the user cannot see -->
<input class="q-field__native" style="width:1px;height:1px">`,
    after: `/* Style the styled wrapper when the proxy inside it has focus, so the
   thing the user actually sees reacts. */
.q-field:focus-within .q-field__control {
  outline: 2px solid #14203c;
  outline-offset: 2px;
}`,
    notes: [
      'The chat widget is third-party — either configure its theme for a visible ring or raise it with the vendor.',
      'See "focus-appearance" for the global rule that causes most of this.',
    ],
  },

  // ---------------------------------------------------------------------------
  'small-targets': {
    title: 'Enlarge undersized targets',
    effort: 'M',
    owner: 'both',
    why: 'Measured geometry shows these focusable elements render below 24x24 CSS pixels.',
    before: `.star { width: 14px; height: 14px; }`,
    after: `.star { width: 14px; height: 14px; padding: 5px; box-sizing: content-box; }`,
    notes: ['Identical remedy to target-size; this entry is sourced from measured geometry rather than axe.'],
  },

  // ---------------------------------------------------------------------------
  'focus-trap': {
    title: 'Release the keyboard focus trap',
    effort: 'M',
    owner: 'both',
    why:
      'Tab stopped advancing and focus remained on one element. A keyboard-only user reaching this point ' +
      'cannot continue through the page — WCAG 2.1.2 is Level A and this is a hard block, not a nuisance.',
    before: `<!-- Widget captures Tab and never forwards it on -->
<div class="widget" onkeydown="if(e.key==='Tab') e.preventDefault()">`,
    after: `<!-- Only a modal may hold focus, and only while open, and Escape must
     always release it back to the trigger. -->
function trapFocus(container, onClose) {
  const focusable = container.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'
  )
  const first = focusable[0]
  const last  = focusable[focusable.length - 1]

  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return onClose()          // always an exit
    if (e.key !== 'Tab') return
    // Cycle within the modal rather than blocking Tab outright
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus()
    }
  })
}`,
    notes: ['Non-modal widgets must never trap Tab at all.'],
  },
}

/** Rules seen in the data that have no bespoke entry yet. */
export const FALLBACK = {
  title: 'Review against the axe rule reference',
  effort: '?',
  owner: 'both',
  why: 'No bespoke remediation authored yet for this rule.',
  before: null,
  after: null,
  notes: [],
}

export function fixFor(ruleId) {
  return FIXES[ruleId] ?? null
}
