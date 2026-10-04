---
name: Biblioteca
description: A school library lending desk where every book wears its forro and every loan is a hand-filled etiqueta escolar.
colors:
  moña: "#2347b5"
  moña-deep: "#172f7a"
  moña-soft: "#dfe7fb"
  girasol: "#ffc53d"
  girasol-hover: "#ffb81a"
  girasol-soft: "#fff4d6"
  tomate: "#e2483d"
  tomate-ink: "#a8241b"
  tomate-soft: "#fde8e5"
  pasto: "#2f9e5b"
  pasto-ink: "#1c6f3e"
  pasto-soft: "#e2f4e8"
  f-cobalto: "#2f5bd3"
  f-tomate: "#d23f2d"
  f-girasol: "#f4b400"
  f-pasto: "#21804a"
  f-violeta: "#6a4bc8"
  f-turquesa: "#0b7e82"
  f-rosa: "#c23d7b"
  f-naranja: "#f08a24"
  f-gris: "#6c7391"
  ground: "#f1f4fb"
  paper: "#ffffff"
  ink: "#1b2340"
  ink-2: "#47527a"
  line: "#d6ddee"
  line-strong: "#b9c4e0"
typography:
  display:
    fontFamily: "Baloo 2, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Baloo 2, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.15
  title:
    fontFamily: "Baloo 2, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 800
    lineHeight: 1.12
  body:
    fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Baloo 2, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1
  hand:
    fontFamily: "Patrick Hand, Comic Sans MS, cursive"
    fontSize: "1.3125rem"
    fontWeight: 400
    lineHeight: 1.1
  hand-input:
    fontFamily: "Patrick Hand, Comic Sans MS, cursive"
    fontSize: "1.625rem"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  sm: "10px"
  md: "16px"
  lg: "22px"
  etiqueta: "12px"
  forro: "6px 12px 12px 6px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "24px"
  xl: "40px"
components:
  button-go:
    backgroundColor: "{colors.girasol}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "44px"
  button-go-hover:
    backgroundColor: "{colors.girasol-hover}"
  button-go-big:
    backgroundColor: "{colors.girasol}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 28px"
    height: "56px"
  button-line:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.moña-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.moña-soft}"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 14px"
    height: "36px"
  chip-pressed:
    backgroundColor: "{colors.moña}"
    textColor: "{colors.paper}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "48px"
  line-input:
    backgroundColor: "transparent"
    textColor: "{colors.moña-deep}"
    typography: "{typography.hand-input}"
    padding: "6px 4px 4px"
    height: "46px"
  line-input-focus:
    backgroundColor: "{colors.moña-soft}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "9px 14px"
  tab-current:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.moña-deep}"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "24px"
  forro:
    backgroundColor: "{colors.f-cobalto}"
    textColor: "{colors.paper}"
    rounded: "{rounded.forro}"
  loan-tile:
    backgroundColor: "{colors.f-cobalto}"
    textColor: "{colors.paper}"
    rounded: "{rounded.forro}"
    padding: "16px 14px 14px 20px"
    height: "220px"
  etiqueta:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.etiqueta}"
    padding: "10px 14px 12px"
  pill-ok:
    backgroundColor: "{colors.pasto-soft}"
    textColor: "{colors.pasto-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-out:
    backgroundColor: "{colors.moña-soft}"
    textColor: "{colors.moña-deep}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-late:
    backgroundColor: "{colors.tomate-soft}"
    textColor: "{colors.tomate-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "12px 12px 12px 18px"
  toast-error:
    backgroundColor: "{colors.tomate-ink}"
---

# Design System: Biblioteca

## Overview

**Creative North Star: "Forro y etiqueta"**

Every book in this library wears its school contact-paper forro, and every loan is an etiqueta escolar filled in by hand. The system is built from those two school objects: saturated colour fields with a faint repeating print stand for books, and white name labels with a rounded double frame stand for loans. Everything else (tables, fields, panels) recedes onto a cool túnica-white ground so the books carry the colour.

It is an operating tool for one librarian at a counter with a queue of children, so density is moderate and every target is large (44px minimum, 56px for the lend action). The children watching see a cheerful wall of covered books; the librarian sees exact dates, codes and states in a hyperlegible face. Cuteness comes from the materials (forros, labels, handwriting), never from emoji or pastel cards.

The cobalt "moña" forro runs across the top as the app's own band, with the same star print the books use. Sunflower yellow is the one action colour.

**Key Characteristics:**
- A book's forro colour is its age band, the same sticker colour the real book carries (Azul 0–7, Rojo 7–10, Verde 10–12; Gris until set). Its print tells books of the same band apart, stable on every screen.
- Loans render as an etiqueta stuck on the book's forro; names and dates on it are in handwriting.
- One action colour (sunflower), used only where something can be pressed.
- Soft, navy-tinted, blurred shadows; pill-shaped controls; a spine-side corner on every forro.
- Spanish (UY) throughout; dates read dd/mm.

## Colors

A cool school-uniform shell (moña blue on túnica white) carrying eight saturated contact-paper forros and one sunflower action colour.

### Primary
- **Moña Blue** (`moña`): the shell. The sticky top band, focus outlines, pressed chips, the current tab's text, link colour and caret. Moña Deep is its pressed/hover and text-on-soft shade; Moña Soft is the selected-row, focus-halo and "Prestado" pill tint.

### Secondary
- **Girasol** (`girasol`): the single action colour. Primary buttons (Prestar, Prestarle un libro, Prestar igual), the toast's undo button, the brand mark in the home link, and the focus outline on band tabs. Girasol Hover deepens it on hover. Girasol Soft is a different job: the warning tint for the demo strip and `notice-warn`, never a button.

### Tertiary
- **Forros** (`f-cobalto`, `f-tomate`, `f-girasol`, `f-pasto`, `f-violeta`, `f-turquesa`, `f-rosa`, `f-naranja`, `f-gris`): book covers carry only the three age-band inks: Cobalto = Azul (0 a 7 años), Tomate = Rojo (7 a 10), Pasto = Verde (10 a 12), and `f-gris` for a book whose band is not set yet (so she can spot it). The other forros stay for student avatars (only the six dark inks, never Girasol or Naranja, because their initials are white). A book's print (dots, stripes, stars, checks, waves, plain) is picked deterministically from its id, so the same book looks the same in the tile wall, the lend form's picked line, listbox options, table swatches and its detail page. Titles on forros are white.

### Neutral
- **Túnica Ground** (`ground`): page background, the Prestar/Devolver switch track, sample code blocks.
- **Paper** (`paper`): panels, tables, etiquetas, inputs, the current tab, line buttons.
- **Ink** (`ink`): all primary text and the toast surface. **Ink 2** (`ink-2`): secondary text, table headers, etiqueta field names, the weekday.
- **Line** (`line`) and **Line Strong** (`line-strong`): input and chip strokes, row dividers, the dotted writing lines on etiquetas, the dashed empty-state border.

### State
- **Tomate** (`tomate`, `tomate-ink`, `tomate-soft`): overdue. The late flag on tiles, the overdue count badge, late due dates written in tomato on the etiqueta, overdue rows, error notices and error toasts. Overdue holds this state until it is resolved.
- **Pasto** (`pasto-ink`, `pasto-soft`): "En la biblioteca" / returned confirmations.

### Named Rules
**The Pressable Sunflower Rule.** Full-strength Girasol (`#ffc53d`) appears only on things that can be pressed. If it is not a button, link or focus ring, it is not Girasol. The Girasol forro (`f-girasol`) is a book colour, and Girasol Soft is a warning tint; neither is the action colour.

**The Forro Is the Sticker Rule.** A book's forro colour is its age band, exactly as the sticker on the real book (set by her, not derived), and its print is derived from its id; both are the same on every screen. Never colour a book by state; state goes on the etiqueta, the late flag or a pill. Never use a non-band ink for a book cover, or a pink or orange book could be read as Rojo.

**The Quiet Print Rule.** Forro prints are white at no more than .14 alpha so white titles keep at least 3:1 against every forro. Book covers only use the dark band inks (Cobalto, Tomate, Pasto, Gris), so titles stay white; a light ink must never become a book colour.

## Typography

**Display Font:** Baloo 2 (variable 400–800, with Atkinson Hyperlegible, system-ui)
**Body Font:** Atkinson Hyperlegible (400/700, with system-ui)
**Label/Mono Font:** Patrick Hand (with Comic Sans MS, cursive) for handwriting only

**Character:** Baloo 2 is round and schoolbook-friendly for headings, tabs and buttons; Atkinson Hyperlegible keeps names, codes and dates unambiguous for the librarian; Patrick Hand is the pen that writes on the label. All three are self-hosted woff2. Body numerals are tabular.

### Hierarchy
- **Display** (800, 2rem, 1.15, -0.01em; 1.625rem under 860px; 2.125rem on detail heads): page titles.
- **Headline** (700, 1.375rem, 1.15): section titles such as "Prestados ahora", with a 0.9375rem Atkinson count beside it in Ink 2.
- **Title** (800, 1.1875rem, 1.12, max three lines): book titles on forro tiles. h3 is 700 at 1.125rem.
- **Body** (400, 1rem, 1.5, tabular numerals): data, sentences, answers.
- **Label** (Baloo 2 600–700, 0.9375–1.25rem, line-height 1): buttons, tabs, chips, field names, table headers.
- **Hand** (Patrick Hand 400, 1.3125rem on etiquetas, 1.625rem on the lend form's writing lines): student name, grade, due date, weekday.

### Named Rules
**The Written On The Label Rule.** Patrick Hand is used only for what is written onto an etiqueta or its form lines (names, grade, dates, weekday). Headings, buttons and data never use it.

**The Calendar Speech Rule.** Dates read dd/mm (dd/mm/yyyy only outside the current year), with "hoy", "mañana" or "ayer" for the nearest days. When a date is being set, its weekday is spelled out beside it in handwriting ("17/10 sábado"), and it is typed the same way.

## Layout

A single centred column, max 1280px, padded 28px 24px 96px (20px 16px under 860px). The Mostrador splits 7fr / 5fr: the counter on the left, the "Preguntá" panel on the right, and the "Prestados ahora" tile wall full-width below. Loan tiles flow in an auto-fill grid (min 196px, gaps 22px by 18px; min 150px under 860px). Settings use two equal columns.

Breakpoints: at 1080px the desk and settings collapse to one column. At 860px the band wraps, tabs become a five-column icon-over-label grid, label-form rows stack field name above line, and tables marked for stacking turn each row into a wrapped card-row with its own `data-label` captions so every action stays on screen. Etiquetas use a container query: under 190px their field names sit above the line, like a stacked school label.

Spacing is a loose rhythm rather than a strict scale: 6px inside fields, 8–10px between chips and inline items, 14px between form parts, 24px for panel padding and desk gaps, 40px between sections.

## Elevation & Depth

Depth is soft and tinted with Moña Deep, never grey and never hard. Surfaces rest on the ground with a low ambient shadow; things that respond (hovered tiles, the lend form, toasts, listboxes) lift to a deeper one.

### Shadow Vocabulary
- **Rest** (`shadow-1`: `0 1px 2px rgba(23,47,122,.08), 0 2px 6px rgba(23,47,122,.06)`): panels, table wraps, forros at rest, the selected switch segment.
- **Lift** (`shadow-2`: `0 2px 4px rgba(23,47,122,.08), 0 10px 24px rgba(23,47,122,.12)`): the counter's lend form, hovered loan tiles, listboxes, toasts.
- **Band** (`0 2px 10px rgba(23,47,122,.25)`): the sticky top band only.
- **Coloured glows**: the Go button carries a warm `0 2px 6px rgba(201,138,0,.35)`, the late flag a tomato `0 2px 6px rgba(168,36,27,.35)`.

### Named Rules
**The Soft Lift Rule.** Every shadow is blurred and tinted. No hard zero-blur offset shadows anywhere. (The etiqueta's inset rings are zero-offset spread rings that draw its double frame, not shadows.)

## Shapes

Pills for everything pressable (buttons, chips, tabs, the switch, status pills, the overdue count). Inputs take a gentle 10px corner, notices and toasts 16px, panels and tables 22px. Forros have a tight 6px corner on the spine side and 12px on the open side, like a covered book seen face-on; the lend form uses the same shape at 10px/16px. Etiquetas are 12px rounded labels with a 2px stroke in the forro's colour, a 3px white gap, and a thin inner ring of the same colour mixed 55% with white. Writing lines are dotted 2px rules; empty states use a 2px dashed border. The brand mark is a sunflower tile turned -4deg.

## Components

### Buttons
Chunky, rounded and obvious.
- **Shape:** full pill, 2px border, minimum 44px tall (36px small, 56px big).
- **Go:** Girasol with ink text and a warm glow; the one primary action per context (Prestar, Prestarle un libro). Hover deepens to Girasol Hover.
- **Line:** Paper with a Line Strong stroke; hover turns the stroke Moña and the text Moña Deep. Secondary actions (Devolver, Editar, Imprimir lista).
- **Quiet:** transparent with Moña Deep text; hover fills Moña Soft. Tertiary and inline actions (Renovar, change-selection "x"). The danger variant takes Tomate Ink text and a Tomate Soft hover.
- **Press / disabled / busy:** press nudges down 1px and scales to .98; disabled drops to .45 opacity; busy to .7 and ignores input.

### Chips
- **Style:** Paper pills with a 2px Line stroke, Baloo 600 at 0.9375rem; hover turns the stroke Moña.
- **State:** pressed chips fill Moña with white text. Used for question shortcuts and the 1/2/3-week due picks (a smaller 32px size).

### Cards / Containers
- **Panel:** Paper, 22px corners, Rest shadow, 24px padding (18px under 860px).
- **Table wrap:** the same surface with horizontal overflow; header row in Baloo 700 Ink 2 over a 2px Line rule, rows divided by 1px Line, overdue rows tinted `#fff7f6`.
- **Notice:** 16px corners, 2px tinted border on a soft fill: warn (Girasol Soft), error (Tomate Soft), ok (Pasto Soft). Actions sit in a wrapped row inside.

### Inputs / Fields
- **Box input:** Paper, 2px Line stroke, 10px corners, 48px tall; hover Line Strong; focus is a Moña stroke with a 4px Moña Soft halo; invalid turns the stroke Tomate. Search fields carry a leading icon.
- **Writing line:** used on the lend form's etiqueta. No box: a 2px dotted bottom rule, Patrick Hand at 1.625rem in Moña Deep. Focus fills Moña Soft with a solid Moña rule; invalid turns Tomate.
- **Listbox:** Paper, 16px corners, Lift shadow, options with a forro swatch, the selected option on Moña Soft.

### Navigation
The band is a cobalt forro: Moña with the star print, sticky, holding the brand and five tabs. Tabs are white Baloo 600 pills with an icon; hover lays a 14% white wash; the current tab is a Paper pill with Moña Deep text. Atrasados carries a Tomate count badge. Under 860px tabs become an equal five-column grid with the icon above a 0.8125rem label.

### Status Pills
Small rounded pills with a leading dot in the text colour: En la biblioteca (Pasto), Prestado (Moña), Atrasado (Tomate), Dado de baja (grey).

### Toasts
Ink pills of 16px corners, bottom-centre, max 560px, with a Girasol undo button. Errors turn Tomate Ink. Routine actions confirm here and offer undo instead of asking first.

### Forro loan tile (signature)
A book on loan: the book's forro (colour and print) at least 220px tall, its title in Baloo 800 (white, or ink on light forros), the copy code on a 90% white pill, and the etiqueta stuck to the bottom with Nombre / Grado / Vuelve lines in handwriting. Overdue tiles get a Tomate "N días tarde" flag hanging off the top-right edge and write the due date in Tomate Ink. Hover lifts 3px with a half-degree tilt. On lend, the tile drops in with a -5deg turn (550ms), the etiqueta slides on (500ms, 200ms delay) and the handwriting writes itself left to right (700ms, 18 steps). All easing is `cubic-bezier(.16,1,.3,1)`, and reduced motion collapses it.

### Lend form (the counter)
The counter is itself a cobalt starred forro with a blank etiqueta on it: Nombre, Libro and Vuelve writing lines, the weekday beside the date, week chips, and the big Go button below the label. A Prestar / Devolver switch (a ground-coloured pill track with a raised Paper segment) sits above it.

### Named Rules
**The Matching Frame Rule.** An etiqueta's frame always takes the colour of the forro it sits on.

**The Counter Is The Forro Rule.** No nested cards. The forro is the container and the etiqueta is the only thing stuck on it; never put a forro or an etiqueta inside a panel to frame it again.

## Do's and Don'ts

### Do:
- **Do** derive a book's forro colour and print from its id and reuse them on every surface that shows that book.
- **Do** frame each etiqueta in the colour of the forro it sits on.
- **Do** keep forro prints at white .14 alpha or less, and switch titles to ink on Girasol and Naranja forros.
- **Do** keep Girasol for things that can be pressed: one Go button per context, the toast's undo, the home mark.
- **Do** write names, grades and dates on etiquetas in Patrick Hand; keep everything else in Baloo 2 or Atkinson Hyperlegible.
- **Do** show dates as dd/mm, with the weekday spelled out wherever a date is being set.
- **Do** use blurred, Moña-tinted shadows: Rest for surfaces, Lift for what responds.
- **Do** keep touch targets at 44px or more and the lend action at 56px.

### Don't:
- **Don't** use hard zero-blur offset shadows.
- **Don't** put an inset side stripe on a forro; the forro's colour and print are the whole identity.
- **Don't** use Girasol on non-pressable surfaces, labels, headings or decoration.
- **Don't** nest cards: the counter is the forro itself, not a panel holding one.
- **Don't** colour a book by its state; state lives on the etiqueta, the late flag and pills.
- **Don't** use Patrick Hand for headings, buttons or table data.
