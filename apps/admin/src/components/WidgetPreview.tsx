// melodyflix admin - widget preview renderer (Section 43 Phase 3)
import type { PageElementNode } from '../lib/api';

interface Props {
  element: PageElementNode;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

function styleToCss(el: PageElementNode): React.CSSProperties {
  const s = el.style as Record<string, any>;
  const css: React.CSSProperties = {};
  if (s.color) css.color = s.color;
  if (s.background_color) css.background = s.background_color;
  if (s.font_size) css.fontSize = typeof s.font_size === 'number' ? `${s.font_size}px` : s.font_size;
  if (s.font_weight) css.fontWeight = s.font_weight;
  if (s.text_align) css.textAlign = s.text_align;
  if (s.padding) css.padding = s.padding;
  if (s.margin) css.margin = s.margin;
  if (s.border_radius) css.borderRadius = s.border_radius;
  if (s.border) css.border = s.border;
  if (s.width) css.width = s.width;
  if (s.max_width) css.maxWidth = s.max_width;
  if (s.opacity !== undefined) css.opacity = s.opacity;
  return css;
}

export default function WidgetPreview({ element, selected, onSelect }: Props) {
  const wrap = (inner: React.ReactNode, extraStyle: React.CSSProperties = {}) => (
    <div
      className={`mf-widget ${selected ? 'selected' : ''}`}
      data-el-id={element.id}
      onClick={(e) => { e.stopPropagation(); onSelect?.(element.id); }}
      style={{ ...styleToCss(element), ...extraStyle }}
    >
      {inner}
    </div>
  );

  const s = element.settings as Record<string, any>;

  switch (element.widget_type) {
    case 'heading': {
      const Tag = ((s.tag as string) ?? 'h2') as keyof JSX.IntrinsicElements;
      const Head = Tag as any;
      return wrap(<Head style={{ margin: 0 }}>{(s.text as string) ?? 'Heading'}</Head>, { width: '100%' });
    }
    case 'text':
      return wrap(<div dangerouslySetInnerHTML={{ __html: (s.html as string) ?? '<p>Text</p>' }} />);
    case 'button':
      return wrap(<a className="mf-preview-btn" href={s.url ?? '#'}>{s.text ?? 'Button'}</a>);
    case 'divider':
      return wrap(<hr style={{ border: 'none', borderTop: '1px solid #444', margin: 0 }} />);
    case 'spacer':
      return wrap(<div style={{ height: (s.height ?? 40) + 'px' }} />);
    case 'image':
      return wrap(s.src
        ? <img src={s.src} alt={s.alt ?? ''} style={{ maxWidth: '100%', display: 'block' }} />
        : <div className="mf-preview-placeholder">🖼️ Image</div>);
    case 'video':
      return wrap(s.src
        ? <video src={s.src} controls style={{ maxWidth: '100%' }} />
        : <div className="mf-preview-placeholder">🎬 Video ({s.provider ?? 'html5'})</div>);
    case 'audio':
      return wrap(s.src
        ? <audio src={s.src} controls style={{ width: '100%' }} />
        : <div className="mf-preview-placeholder">🎵 Audio</div>);
    case 'icon':
      return wrap(<span style={{ fontSize: (s.size ?? 24) + 'px' }}>⭐</span>);
    case 'icon_list':
      return wrap(<div className="mf-preview-placeholder">☰ Icon List ({(s.items as any[])?.length ?? 0})</div>);
    case 'gallery':
      return wrap(<div className="mf-preview-placeholder">🖼️ Gallery ({(s.images as any[])?.length ?? 0})</div>);
    case 'counter':
      return wrap(<div className="mf-preview-counter">{s.end ?? 100}</div>);
    case 'progress':
      return wrap(<div className="mf-preview-progress"><div style={{ width: (s.value ?? 50) + '%' }} /></div>);
    case 'testimonial':
      return wrap(<blockquote className="mf-preview-quote">"{s.quote || 'Customer quote'}"<footer>— {s.author || 'Anonymous'}</footer></blockquote>);
    case 'social_icons':
      return wrap(<div className="mf-preview-placeholder">🔗 Social Icons</div>);
    case 'alert':
      return wrap(<div className={`mf-preview-alert alert-${s.type ?? 'info'}`}>{s.text || 'Alert'}</div>);
    case 'html':
      return wrap(<div dangerouslySetInnerHTML={{ __html: (s.html as string) ?? '<em>Custom HTML</em>' }} />);
    case 'shortcode':
      return wrap(<code>[{(s.code as string) ?? 'shortcode'}]</code>);
    case 'menu':
      return wrap(<div className="mf-preview-placeholder">📋 Nav Menu ({s.location ?? 'header'})</div>);
    case 'breadcrumbs':
      return wrap(<div className="mf-preview-placeholder">🏠 / ... / Page</div>);
    case 'post_title':
      return wrap(<h2>Page Title</h2>);
    case 'post_content':
      return wrap(<div className="mf-preview-placeholder">Page Content</div>);
    case 'tabs':
      return wrap(<div className="mf-preview-placeholder">📑 Tabs ({(s.tabs as any[])?.length ?? 0})</div>);
    case 'accordion':
    case 'toggle':
      return wrap(<div className="mf-preview-placeholder">▼ {element.widget_type} ({(s.items as any[])?.length ?? 0})</div>);
    case 'form':
      return wrap(
        <div className="mf-preview-form">
          <div className="mf-preview-placeholder">📝 Form ({(s.fields as any[])?.length ?? 0} fields)</div>
          <button className="mf-preview-btn" disabled>{s.submit_label ?? 'Submit'}</button>
        </div>
      );
    case 'search':
      return wrap(<input placeholder={s.placeholder ?? 'Search…'} disabled style={{ padding: 8, width: '100%' }} />);
    case 'dyn_video_title':
      return wrap(<h3>[Dynamic: Video Title]</h3>);
    case 'dyn_video_thumbnail':
      return wrap(<div className="mf-preview-placeholder">🎞️ [Dynamic: Thumbnail]</div>);
    case 'dyn_channel_name':
      return wrap(<div>📺 [Dynamic: Channel Name]</div>);
    case 'dyn_category_list':
      return wrap(<div className="mf-preview-placeholder">🏷️ [Dynamic: Categories]</div>);
    case 'dyn_trending_grid':
    case 'dyn_content_type_grid':
      return wrap(<div className="mf-preview-placeholder">📊 Grid: {s.content_type ?? 'video'} · {s.per_page ?? 12} items</div>);
    default:
      return wrap(<div className="mf-preview-placeholder">{element.widget_type ?? element.element_type}</div>);
  }
}
