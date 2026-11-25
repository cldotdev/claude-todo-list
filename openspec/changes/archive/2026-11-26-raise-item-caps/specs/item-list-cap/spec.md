## Purpose

Bounds the list of open items, so the request that carries the whole list to the model stays within what the model can read, and defines what happens to additions that do not fit.

## ADDED Requirements

### Requirement: The List Holds at Most 999 Items

The list SHALL hold at most 999 items. When the per-turn update or `/todos refresh` would take the list past that, the items already on the list SHALL stay, the new items SHALL be added in the order the reply gives them while room remains, and the rest SHALL be dropped without going to the trash.

#### Scenario: A List Grows Past 99 Items

- **WHEN** the list holds 100 items and the per-turn update adds one
- **THEN** the list holds 101 items and the new item is last

#### Scenario: A Full List Drops an Added Item

- **WHEN** the list holds 999 items and the per-turn update adds one
- **THEN** the list still holds the same 999 items, and the added item is neither on the list nor in the trash
