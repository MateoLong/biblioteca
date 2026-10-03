# Product

<!-- impeccable:product-schema 1 -->

> Facts below come from the owner's brief ("my mom works at a school library… keep the registry of which books are taken by which students… cute UI since it's for kids… local product") plus grill answers the owner delegated to Claude ("go with your suggestions"). Lines marked *(inferred)* were not confirmed by a human.

## Platform

web

## Stack

delegated: Python 3 standard library (http.server + sqlite3) serving vanilla HTML/CSS/JS, no build step, no dependencies. Chosen so it runs offline on a school Mac/PC with nothing to install. *(inferred)*

## Users

One school librarian (the owner's mother) at the library desk, operating it during recess and class visits while children queue at the counter. Children see the screen but do not operate it. *(inferred: only she operates it)*

## Product Purpose

Replace the paper/Excel lending registry: record which student took which book copy, record returns, and answer her everyday questions instantly ("who has this book?", "what does this kid have?", "what is overdue?", "what did 4°B read?"). Success: a loan or a return takes under 10 seconds and any question is answered from one search box.

## Positioning

A registry built for one school library desk, not a library management system: no cataloguing standards, no accounts, no internet. Fast at the counter, friendly to the children watching.

## Operating Context

- Busy moments: a line of children, each returning or borrowing one or two books.
- Books are physical copies, labelled with a short code (e.g. B-0042); a school often owns several copies of a title. *(inferred)*
- Students are identified by name + class (e.g. "4°B"). *(inferred)*
- Loan period default 14 days, editable per loan and in settings; default limit 2 books per student, warns but never blocks. *(inferred)*
- Existing data probably lives in Excel or paper; CSV import and export needed. *(inferred)*

## Capabilities and Constraints

- Lend, return, undo a return, edit a due date.
- Questions: who has a book; what a student has; overdue list; a book's history; a student's history; class view; most-read.
- Books and students are archived, never deleted, so history survives.
- Full history kept forever. Single SQLite file; one-click CSV backup.
- Offline only, single user, no login. Spanish UI, dd/mm dates.
- No AI or network calls: children's data stays on the machine.

## Brand Commitments

- "Cute UI since it's for kids" (owner, binding).
- Spanish (Uruguay) copy.

## Evidence on Hand

No real catalogue or student list yet. Any demo data is synthetic and must be labelled as example data that she can clear.

## Product Principles

1. The counter moment wins: lending and returning are always one step away.
2. Every question has an answer on screen, not in a report.
3. Never lose history: archive, don't delete; undo, don't confirm.
4. Warm for the children, calm and legible for the librarian.

## Accessibility & Inclusion

Large tap/click targets and readable type for a non-technical adult user; WCAG AA contrast. Works with a USB barcode scanner as keyboard input.
