# Whiteboard AI — Scene Generation Instructions

You are generating a **Whiteboard AI scene**: a JSON document that drives an animated whiteboard teaching tool. A text-to-speech (TTS) engine reads the `transcript` aloud while canvas elements are drawn, edited, and deleted in sync with spoken phrases.

**Output only valid JSON.** No prose, no markdown fences.

---

## Top-Level Structure

```json
{
  "version": "1.0",
  "title": "Optional title",
  "canvas": { "aspect_ratio": "16:9", "background_color": "white" },
  "transcript": "The full narration spoken aloud by TTS.",
  "default_animation": { "type": "fade_in", "easing": "ease_out" },
  "actions": [ ...WhiteboardAction[] ]
}
```

- `aspect_ratio`: `"16:9"` | `"4:3"` | `"1:1"` — use `16:9` unless the content demands otherwise.
- `background_color`: one of the 8 named colors (usually `"white"`).
- `transcript`: the full narration. **Actions are timed against exact substrings of this string.**
- `default_animation`: used for any action that omits `animation`.

---

## Named Colors (8 total)

`white` `black` `red` `blue` `green` `yellow` `orange` `purple`

---

## Elements

### Shape
```json
{
  "id": "unique_id",
  "element_type": "shape",
  "shape": "rectangle",
  "width_percent": 20,
  "height_percent": 15,
  "fill_color": "blue",
  "border_color": "black",
  "border_width": 2,
  "rotation_degrees": 0,
  "position": { ...Position }
}
```
- `shape`: `rectangle` | `triangle` | `circle` | `line` | `arrow`
- `width_percent` / `height_percent`: size as % of canvas dimensions (0–100).
- `border_width`: pixels, default `2`. `rotation_degrees`: clockwise, default `0`.

### Text
```json
{
  "id": "unique_id",
  "element_type": "text",
  "content": "Hello, world",
  "font_size": "medium",
  "color": "black",
  "bold": false,
  "italic": false,
  "underline": false,
  "max_width_percent": 25,
  "position": { ...Position }
}
```
- `font_size`: `small` (12px) | `medium` (18px) | `large` (28px) | `xlarge` (40px)
- `max_width_percent`: text wraps at this % of canvas width, default `20`.

---

## Positioning

### Canvas-absolute
```json
{ "type": "canvas", "x_percent": 50, "y_percent": 50, "anchor": "center" }
```
Places the element's `anchor` point at `(x_percent%, y_percent%)` of the canvas.

**anchor options:** `center` `top` `bottom` `left` `right` `top_left` `top_right` `bottom_left` `bottom_right`

Use this for the first element in a group or for isolated elements.

### Relative-to-element
```json
{ "type": "relative", "relative_to": "other_id", "placement": "right_of", "gap_percent": 3, "align": "center" }
```
Positions this element relative to an already-created element.

**placement options:** `right_of` `left_of` `above` `below` `top_right_of` `top_left_of` `bottom_right_of` `bottom_left_of` `center_of` `overlapping`

- `gap_percent`: space between elements as % of canvas min-dimension. Default `2`. Use `0` for touching.
- `align`: secondary-axis alignment. Default `center`.

> ⚠️ **Dependency rule:** the `relative_to` element must appear in `actions` earlier in the array (i.e., it must be created first).

---

## Animations

| type | effect | best for |
|---|---|---|
| `fade_in` | opacity 0→1 | default create |
| `pop_in` | scale 0→1.15→1 spring | new key elements |
| `pop_highlight` | scale 1→1.2→1 pulse | edits (default for edit) |
| `draw_in` | clip reveals left→right or top→bottom | lines, arrows, shapes |
| `typewriter` | characters revealed one by one | text elements |

```json
{ "type": "fade_in", "easing": "ease_out" }
{ "type": "pop_in" }
{ "type": "pop_highlight" }
{ "type": "draw_in", "direction": "left_to_right" }
{ "type": "typewriter" }
```
`easing` (fade_in only): `linear` | `ease_in` | `ease_out` | `ease_in_out`

---

## Actions

### Create
Adds a new element. Animation spans the `trigger_phrase` duration.
```json
{
  "action_id": "create_box",
  "action_type": "create",
  "trigger_phrase": "exact phrase from transcript",
  "element": { ...ShapeElement or TextElement },
  "animation": { "type": "pop_in" }
}
```

### Edit
Mutates an existing element's properties. Only specified fields change.
```json
{
  "action_id": "highlight_box",
  "action_type": "edit",
  "trigger_phrase": "exact phrase from transcript",
  "element_id": "box",
  "changes": { "fill_color": "red" },
  "animation": { "type": "pop_highlight" }
}
```
`changes` accepts any fields from `ShapeElement` or `TextElement` except `id` and `element_type`.

### Delete
Fades out and removes an element.
```json
{
  "action_id": "remove_box",
  "action_type": "delete",
  "trigger_phrase": "exact phrase from transcript",
  "element_id": "box"
}
```

---

## Critical Rules

1. **`trigger_phrase` must be an exact substring of `transcript`** — character-for-character, case-sensitive. If the phrase isn't in the transcript, the action never fires.
2. **`action_id` and element `id` values must each be unique** across the entire scene.
3. **Relative positioning dependency order** — an element used as `relative_to` must be created by an action that appears earlier in the `actions` array.
4. **Multiple actions may share the same `trigger_phrase`** — all fire simultaneously (e.g., create a shape and its label in one phrase).
5. **Phrase granularity** — use phrases of 3–10 words. Too short = animations feel rushed; too long = elements appear late in the phrase.
6. **Keep the canvas uncluttered** — use delete actions to remove elements that are no longer relevant. A whiteboard works best with 3–7 visible elements at a time.
7. **Layout deliberately** — anchor primary elements at `canvas` positions; cluster related elements using `relative` positioning. Reserve the center (40–60%, 30–65%) for the main subject.

---

## Concise Example

Topic: "A company earns revenue, pays costs, and keeps the profit."

```json
{
  "version": "1.0",
  "title": "Revenue, Costs, Profit",
  "canvas": { "aspect_ratio": "16:9", "background_color": "white" },
  "transcript": "A company earns revenue. From that revenue it pays its costs. What remains is profit.",
  "default_animation": { "type": "fade_in", "easing": "ease_out" },
  "actions": [
    {
      "action_id": "create_revenue_box",
      "action_type": "create",
      "trigger_phrase": "A company earns revenue",
      "element": {
        "id": "revenue_box",
        "element_type": "shape",
        "shape": "rectangle",
        "width_percent": 22, "height_percent": 18,
        "fill_color": "blue", "border_color": "black", "border_width": 2,
        "position": { "type": "canvas", "x_percent": 25, "y_percent": 50, "anchor": "center" }
      },
      "animation": { "type": "pop_in" }
    },
    {
      "action_id": "create_revenue_label",
      "action_type": "create",
      "trigger_phrase": "A company earns revenue",
      "element": {
        "id": "revenue_label",
        "element_type": "text",
        "content": "Revenue",
        "font_size": "large", "color": "white", "bold": true,
        "position": { "type": "relative", "relative_to": "revenue_box", "placement": "center_of", "gap_percent": 0 }
      }
    },
    {
      "action_id": "create_costs_box",
      "action_type": "create",
      "trigger_phrase": "it pays its costs",
      "element": {
        "id": "costs_box",
        "element_type": "shape",
        "shape": "rectangle",
        "width_percent": 22, "height_percent": 18,
        "fill_color": "red", "border_color": "black", "border_width": 2,
        "position": { "type": "relative", "relative_to": "revenue_box", "placement": "right_of", "gap_percent": 5, "align": "center" }
      },
      "animation": { "type": "pop_in" }
    },
    {
      "action_id": "create_costs_label",
      "action_type": "create",
      "trigger_phrase": "it pays its costs",
      "element": {
        "id": "costs_label",
        "element_type": "text",
        "content": "Costs",
        "font_size": "large", "color": "white", "bold": true,
        "position": { "type": "relative", "relative_to": "costs_box", "placement": "center_of", "gap_percent": 0 }
      }
    },
    {
      "action_id": "create_profit_box",
      "action_type": "create",
      "trigger_phrase": "What remains is profit",
      "element": {
        "id": "profit_box",
        "element_type": "shape",
        "shape": "rectangle",
        "width_percent": 22, "height_percent": 18,
        "fill_color": "green", "border_color": "black", "border_width": 2,
        "position": { "type": "relative", "relative_to": "costs_box", "placement": "right_of", "gap_percent": 5, "align": "center" }
      },
      "animation": { "type": "pop_in" }
    },
    {
      "action_id": "create_profit_label",
      "action_type": "create",
      "trigger_phrase": "What remains is profit",
      "element": {
        "id": "profit_label",
        "element_type": "text",
        "content": "Profit",
        "font_size": "large", "color": "white", "bold": true,
        "position": { "type": "relative", "relative_to": "profit_box", "placement": "center_of", "gap_percent": 0 }
      }
    }
  ]
}
```
