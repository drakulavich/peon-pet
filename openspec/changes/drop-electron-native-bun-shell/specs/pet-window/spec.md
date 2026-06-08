# pet-window

## ADDED Requirements

### Requirement: Corner-anchored floating pet window

The pet window SHALL appear at the configured screen corner (default bottom-left)
of the primary display's work area and SHALL float above all other windows,
including full-screen Spaces.

#### Scenario: Default placement

- **WHEN** the app starts with no configured corner
- **THEN** the pet window is positioned in the bottom-left corner of the primary
  work area, inset by the standard margin

#### Scenario: Floats over a full-screen app

- **WHEN** another application is in full-screen mode on the same display
- **THEN** the pet remains visible on top of it
- **AND** the pet does not steal keyboard focus from that application

### Requirement: Click-through with hover capture

The pet window SHALL ignore mouse events by default so clicks pass through to
windows beneath it, and SHALL capture mouse movement only while the cursor is
within the window bounds, so the renderer receives hover events for tooltips.

#### Scenario: Click passes through

- **WHEN** the cursor is over the pet and the user clicks
- **THEN** the click is delivered to whatever window is beneath the pet
- **AND** the pet itself does not receive or consume the click

#### Scenario: Hover enables tooltips

- **WHEN** the cursor enters the pet window bounds
- **THEN** the shell stops ignoring mouse events for that window
- **AND** the renderer receives mousemove events and can show tooltips
- **WHEN** the cursor leaves the window bounds
- **THEN** the shell resumes ignoring mouse events (click-through restored)

### Requirement: Drag to move

The user SHALL be able to drag the pet to a new position; while dragging, the
window follows the cursor.

#### Scenario: Drag relocates the pet

- **WHEN** the renderer sends a drag-start message and the cursor moves
- **THEN** the window position tracks the cursor until a drag-stop message
- **AND** after drag-stop, click-through behavior resumes per hover state

### Requirement: Sub-agent mini-pet windows

The system SHALL show up to five additional mini-pet windows, one per active Claude
Code sub-agent, stacked above the main pet, each with the same floating and
click-through traits, and SHALL remove them when the sub-agent stops or a TTL
elapses.

#### Scenario: Sub-agent appears and is removed

- **WHEN** a `SubagentStart` event is observed and fewer than five mini-pets exist
- **THEN** a new mini-pet window appears stacked above the main pet
- **WHEN** the matching `SubagentStop` is observed, or the TTL elapses without one
- **THEN** that mini-pet window is destroyed and the remaining ones re-stack

### Requirement: Visibility, dock menu, and single instance

The system SHALL provide a macOS dock icon and menu to hide/show the pet (and its
mini-pets) and to quit, and SHALL ensure only one instance runs at a time.

#### Scenario: Hide and show

- **WHEN** the user selects Hide Pet from the dock menu
- **THEN** the main pet and all mini-pets are hidden without quitting
- **WHEN** the user selects Show Pet
- **THEN** they reappear at their prior positions

#### Scenario: Second launch is prevented

- **WHEN** the app is already running and the user launches it again
- **THEN** the second process exits and the existing instance keeps running
