import {DataRenderer, DataRendererView} from "./data_renderer"
import type {GlyphRendererView} from "./glyph_renderer"
import {GlyphRenderer} from "./glyph_renderer"
import type {Renderer} from "./renderer"
import type {GlyphView} from "../glyphs/glyph"
import type * as p from "core/properties"
import type {IterViews} from "core/build_views"
import {build_view} from "core/build_views"
import type {SelectionManager} from "core/selection_manager"

export class ContourRendererView extends DataRendererView {
  declare model: ContourRenderer

  fill_view: GlyphRendererView
  line_view: GlyphRendererView

  override *children(): IterViews {
    yield* super.children()
    yield this.fill_view
    yield this.line_view
  }

  get glyph_view(): GlyphView {
    if (this.fill_view.glyph.data_size > 0) {
      return this.fill_view.glyph
    } else {
      return this.line_view.glyph
    }
  }

  override async lazy_initialize(): Promise<void> {
    await super.lazy_initialize()
    const {parent} = this
    const {fill_renderer, line_renderer} = this.model
    this.fill_view = await build_view(fill_renderer, {parent})
    this.line_view = await build_view(line_renderer, {parent})
  }

  override remove(): void {
    this.fill_view.remove()
    this.line_view.remove()
    super.remove()
  }

  protected _render(): void {
    this.fill_view.render()
    this.line_view.render()
  }

  override renderer_view<T extends Renderer>(renderer: T): T["__view_type__"] | undefined {
    if (renderer instanceof GlyphRenderer) {
      if (renderer == this.fill_view.model) {
        return this.fill_view
      }
      if (renderer == this.line_view.model) {
        return this.line_view
      }
    }
    return super.renderer_view(renderer)
  }
}

export namespace ContourRenderer {
  export type Attrs = p.AttrsOf<Props>

  export type Props = DataRenderer.Props & {
    fill_renderer: p.Property<GlyphRenderer>
    line_renderer: p.Property<GlyphRenderer>
    levels: p.Property<number[]>
  }
}

export interface ContourRenderer extends ContourRenderer.Attrs {}

export class ContourRenderer extends DataRenderer {
  declare properties: ContourRenderer.Props
  declare __view_type__: ContourRendererView

  constructor(attrs?: Partial<ContourRenderer.Attrs>) {
    super(attrs)
  }

  static {
    this.prototype.default_view = ContourRendererView

    this.define<ContourRenderer.Props>(({Array, Number, Ref}) => ({
      fill_renderer: [ Ref(GlyphRenderer) ],
      line_renderer: [ Ref(GlyphRenderer) ],
      levels:        [ Array(Number), [] ],
    }))
  }

  get_selection_manager(): SelectionManager {
    return this.fill_renderer.data_source.selection_manager
  }
}
