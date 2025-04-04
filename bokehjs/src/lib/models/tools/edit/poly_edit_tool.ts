import type {PanEvent, TapEvent, MoveEvent, KeyEvent, UIEvent} from "core/ui_events"
import {isArray} from "core/util/types"
import {dict} from "core/util/object"
import type {MultiLine} from "../../glyphs/multi_line"
import type {Patches} from "../../glyphs/patches"
import {GlyphRenderer} from "../../renderers/glyph_renderer"
import {PolyTool, PolyToolView} from "./poly_tool"
import type * as p from "core/properties"
import {tool_icon_poly_edit} from "styles/icons.css"

export interface HasPolyGlyph {
  glyph: MultiLine | Patches
}

export class PolyEditToolView extends PolyToolView {
  declare model: PolyEditTool

  _selected_renderer: GlyphRenderer | null
  _drawing: boolean = false
  _cur_index: number | null = null

  override _press(ev: TapEvent): void {
    if (this.model.vertex_renderer == null || !this.model.active) {
      return
    }
    const point = this._map_drag(ev.sx, ev.sy, this.model.vertex_renderer)
    if (point == null) {
      return
    }
    const [x, y] = point

    // Perform hit testing
    const vertex_selected = this._select_event(ev, "replace", [this.model.vertex_renderer])
    const point_cds = this.model.vertex_renderer.data_source
    // Type once dataspecs are typed
    const point_glyph: any = this.model.vertex_renderer.glyph
    const [pxkey, pykey] = [point_glyph.x.field, point_glyph.y.field]
    if (vertex_selected.length != 0 && this._selected_renderer != null) {
      // Insert a new point after the selected vertex and enter draw mode
      const index = point_cds.selected.indices[0]
      if (this._drawing) {
        this._drawing = false
        point_cds.selection_manager.clear()
      } else {
        point_cds.selected.indices = [index+1]
        if (pxkey) {
          point_cds.get_array(pxkey).splice(index+1, 0, x)
        }
        if (pykey) {
          point_cds.get_array(pykey).splice(index+1, 0, y)
        }
        this._drawing = true
      }
      point_cds.change.emit()
      this._emit_cds_changes(this._selected_renderer.data_source)
    } else {
      this._show_vertices(ev)
    }
  }

  _show_vertices(ev: UIEvent): void {
    if (!this.model.active) {
      return
    }
    if (this.model.renderers.length == 0) {
      return
    }

    const vsync_renderer = this.model.renderers[0]
    const vsync_updater = () => this._update_vertices(vsync_renderer)
    const vsync_ds = vsync_renderer.data_source

    const renderers = this._select_event(ev, "replace", this.model.renderers)
    if (renderers.length == 0) {
      this._set_vertices([], [])
      this._selected_renderer = null
      this._drawing = false
      this._cur_index = null
      vsync_ds.disconnect(vsync_ds.properties.data.change, vsync_updater)
      return
    }

    vsync_ds.connect(vsync_ds.properties.data.change, vsync_updater)

    this._cur_index = renderers[0].data_source.selected.indices[0]
    this._update_vertices(renderers[0])
  }

  _update_vertices(renderer: GlyphRenderer): void {
    const glyph: any = renderer.glyph
    const data = dict(renderer.data_source.data)
    const index = this._cur_index
    const [xkey, ykey] = [glyph.xs.field, glyph.ys.field]

    if (this._drawing) {
      return
    }
    if ((index == null) && (xkey || ykey)) {
      return
    }

    let xs: number[]
    let ys: number[]
    if (xkey && index != null) { // redundant xkey null check to satisfy build-time checks
      const column = data.get(xkey) ?? []
      xs = column[index] as number[]
      if (!isArray(xs)) {
        column[index] = xs = Array.from(xs)
      }
    } else {
      xs = glyph.xs.value
    }

    if (ykey && index != null) {
      const column = data.get(ykey) ?? []
      ys = column[index] as number[]
      if (!isArray(ys)) {
        column[index] = ys = Array.from(ys)
      }
    } else {
      ys = glyph.ys.value
    }
    this._selected_renderer = renderer
    this._set_vertices(xs, ys)
  }

  override _move(ev: MoveEvent): void {
    if (this._drawing && this._selected_renderer != null) {
      const renderer = this.model.vertex_renderer
      if (renderer == null) {
        return
      }
      const cds = renderer.data_source
      const data = dict(cds.data)
      const glyph: any = renderer.glyph
      const point = this._map_drag(ev.sx, ev.sy, renderer)
      if (point == null) {
        return
      }
      let [x, y] = point
      const indices = cds.selected.indices
      ;[x, y] = this._snap_to_vertex(ev, x, y)
      cds.selected.indices = indices
      const [xkey, ykey] = [glyph.x.field, glyph.y.field]
      const index = indices[0]
      if (xkey) {
        data.get(xkey)![index] = x
      }
      if (ykey) {
        data.get(ykey)![index] = y
      }
      cds.change.emit()
      this._selected_renderer.data_source.change.emit()
    }
  }

  override _tap(ev: TapEvent): void {
    const renderer = this.model.vertex_renderer
    if (renderer == null) {
      return
    }
    const point = this._map_drag(ev.sx, ev.sy, renderer)
    if (point == null) {
      return
    } else if (this._drawing && this._selected_renderer != null) {
      let [x, y] = point
      const cds = renderer.data_source
      // Type once dataspecs are typed
      const glyph: any = renderer.glyph
      const [xkey, ykey] = [glyph.x.field, glyph.y.field]
      const indices = cds.selected.indices
      ;[x, y] = this._snap_to_vertex(ev, x, y)
      const index = indices[0]
      cds.selected.indices = [index+1]
      if (xkey) {
        const xs = cds.get_array(xkey)
        const nx = xs[index]
        xs[index] = x
        xs.splice(index+1, 0, nx)
      }
      if (ykey) {
        const ys = cds.get_array(ykey)
        const ny = ys[index]
        ys[index] = y
        ys.splice(index+1, 0, ny)
      }
      cds.change.emit()
      this._emit_cds_changes(this._selected_renderer.data_source, true, false, true)
      return
    }
    const mode = this._select_mode(ev)
    this._select_event(ev, mode, [renderer])
    this._select_event(ev, mode, this.model.renderers)
  }

  _remove_vertex(): void {
    if (!this._drawing || this._selected_renderer == null) {
      return
    }
    const renderer = this.model.vertex_renderer
    if (renderer == null) {
      return
    }
    const cds = renderer.data_source
    // Type once dataspecs are typed
    const glyph: any = renderer.glyph
    const index = cds.selected.indices[0]
    const [xkey, ykey] = [glyph.x.field, glyph.y.field]
    if (xkey) {
      cds.get_array(xkey).splice(index, 1)
    }
    if (ykey) {
      cds.get_array(ykey).splice(index, 1)
    }
    cds.change.emit()
    this._emit_cds_changes(this._selected_renderer.data_source)
  }

  override _pan_start(ev: PanEvent): void {
    if (this.model.vertex_renderer == null) {
      return
    }
    this._select_event(ev, "append", [this.model.vertex_renderer])
    this._basepoint = [ev.sx, ev.sy]
  }

  override _pan(ev: PanEvent): void {
    if (this._basepoint == null) {
      return
    }
    if (this.model.vertex_renderer == null) {
      return
    }
    this._drag_points(ev, [this.model.vertex_renderer])
    if (this._selected_renderer != null) {
      this._selected_renderer.data_source.change.emit()
    }
  }

  override _pan_end(ev: PanEvent): void {
    if (this._basepoint == null) {
      return
    }
    if (this.model.vertex_renderer == null) {
      return
    }
    this._drag_points(ev, [this.model.vertex_renderer])
    this._emit_cds_changes(this.model.vertex_renderer.data_source, false, true, true)
    if (this._selected_renderer != null) {
      this._emit_cds_changes(this._selected_renderer.data_source)
    }
    this._basepoint = null
  }

  override _keyup(ev: KeyEvent): void {
    if (!this.model.active || !this._mouse_in_frame) {
      return
    }
    let renderers: GlyphRenderer[]
    if (this._selected_renderer != null) {
      const {vertex_renderer} = this.model
      renderers = vertex_renderer != null ? [vertex_renderer] : []
    } else {
      renderers = this.model.renderers
    }
    for (const renderer of renderers) {
      if (ev.key == "Backspace") {
        this._delete_selected(renderer)
        if (this._selected_renderer != null) {
          this._emit_cds_changes(this._selected_renderer.data_source)
        }
      } else if (ev.key == "Escape") {
        if (this._drawing) {
          this._remove_vertex()
          this._drawing = false
        } else if (this._selected_renderer != null) {
          this._hide_vertices()
        }
        renderer.data_source.selection_manager.clear()
      }
    }
  }

  override deactivate(): void {
    if (this._selected_renderer == null) {
      return
    } else if (this._drawing) {
      this._remove_vertex()
      this._drawing = false
    }
    this._hide_vertices()
  }
}

export namespace PolyEditTool {
  export type Attrs = p.AttrsOf<Props>

  export type Props = PolyTool.Props & {
    renderers: p.Property<(GlyphRenderer & HasPolyGlyph)[]>
  }
}

export interface PolyEditTool extends PolyEditTool.Attrs {}

export class PolyEditTool extends PolyTool {
  declare properties: PolyEditTool.Props
  declare __view_type__: PolyEditToolView

  constructor(attrs?: Partial<PolyEditTool.Attrs>) {
    super(attrs)
  }

  static {
    this.prototype.default_view = PolyEditToolView

    this.define<PolyEditTool.Props>(({Array, Ref}) => ({
      renderers: [ Array(Ref<GlyphRenderer & HasPolyGlyph>(GlyphRenderer as any)), [] ],
    }))
  }

  override tool_name = "Poly Edit Tool"
  override tool_icon = tool_icon_poly_edit
  override event_type = ["tap" as "tap", "press" as "press", "pan" as "pan", "move" as "move"]
  override default_order = 4
}
