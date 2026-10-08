// melodyflix admin - Elementor-style page builder (Section 43 Phase 3)
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  listCustomPages, getPageTree, addElement, updateElement, deleteElement,
  duplicateElement, moveElement, reorderElements, listWidgets,
  createRevision, listRevisions, restoreRevision,
  getGlobalStyles, setGlobalStyle, listTemplates, savePageAsTemplate,
  applyTemplate, type CustomPage, type PageElementNode, type WidgetDefinition,
  type PageRevision, type GlobalStyle, type PageTemplate,
} from '../lib/api';
import WidgetPreview from '../components/WidgetPreview';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';

type Device = 'desktop' | 'tablet' | 'mobile';

function findElement(ns: PageElementNode[], id: string): PageElementNode | null {
  for (const n of ns) {
    if (n.id === id) return n;
    const hit = findElement(n.children, id);
    if (hit) return hit;
  }
  return null;
}

export default function PageBuilder() {
  const [pages, setPages] = useState<CustomPage[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [tree, setTree] = useState<PageElementNode[]>([]);
  const [widgets, setWidgets] = useState<WidgetDefinition[]>([]);
  const [widgetFilter, setWidgetFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [templates, setTemplates] = useState<PageTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [globalStyles, setGlobalStyles] = useState<GlobalStyle[]>([]);
  const [inspectorTab, setInspectorTab] = useState<'content' | 'style' | 'advanced'>('content');
  const [draggingWidgetType, setDraggingWidgetType] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // ---- bootstrap ----
  useEffect(() => {
    listCustomPages().then((r) => {
      setPages(r.pages);
      if (r.pages.length && !activePageId) setActivePageId(r.pages[0].id);
    }).catch((e) => setError(e.message));
    listWidgets().then((r) => setWidgets(r.widgets)).catch((e) => setError(e.message));
    getGlobalStyles().then((r) => setGlobalStyles(r.list)).catch(() => {});
  }, []);

  const reloadTree = useCallback(async (pageId: string) => {
    setLoading(true);
    try {
      const r = await getPageTree(pageId);
      setTree(r.tree);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (activePageId) reloadTree(activePageId);
  }, [activePageId, reloadTree]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    function find(ns: PageElementNode[]): PageElementNode | null {
      for (const n of ns) {
        if (n.id === selectedId) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    }
    return find(tree);
  }, [selectedId, tree]);

  const filteredWidgets = useMemo(
    () => widgetFilter === 'all' ? widgets : widgets.filter((w) => w.category === widgetFilter),
    [widgets, widgetFilter],
  );

  // ---- actions ----
  async function addWidget(widgetType: string) {
    if (!activePageId) return;
    const def = widgets.find((w) => w.type === widgetType);
    // find insertion parent: if selected is a container/section, insert inside;
    // else if selected has a parent, insert as sibling
    let parentId: string | null = null;
    if (selected) {
      if (selected.element_type === 'section' || selected.element_type === 'container' || selected.element_type === 'column') {
        // pick or create column
        const col = selected.children.find((c) => c.element_type === 'column');
        if (selected.element_type === 'column') parentId = selected.id;
        else if (col) parentId = col.id;
        else parentId = selected.id; // will insert a widget directly if no column
      } else {
        parentId = selected.parent_id;
      }
    }
    try {
      await addElement(activePageId, {
        parent_id: parentId,
        element_type: 'widget',
        widget_type: widgetType,
        settings: (def?.default_settings ?? {}) as Record<string, unknown>,
        style: (def?.default_style ?? {}) as Record<string, unknown>,
      });
      await reloadTree(activePageId);
    } catch (e: any) { setError(e.message); }
  }

  async function addSection() {
    if (!activePageId) return;
    try {
      const sec = await addElement(activePageId, { element_type: 'section', settings: { layout: 'boxed' } });
      await addElement(activePageId, { parent_id: sec.id, element_type: 'column', settings: { width: 100 } });
      await reloadTree(activePageId);
      setSelectedId(sec.id);
    } catch (e: any) { setError(e.message); }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!confirm(`Delete ${selected.widget_type ?? selected.element_type}?`)) return;
    try {
      await deleteElement(selected.id);
      setSelectedId(null);
      if (activePageId) await reloadTree(activePageId);
    } catch (e: any) { setError(e.message); }
  }

  async function duplicateSelected() {
    if (!selected) return;
    try {
      await duplicateElement(selected.id);
      if (activePageId) await reloadTree(activePageId);
    } catch (e: any) { setError(e.message); }
  }

  async function updateSelected(patch: { settings?: Record<string, unknown>; style?: Record<string, unknown>; responsive?: Record<string, unknown>; advanced?: Record<string, unknown> }) {
    if (!selected) return;
    // optimistic local merge for snappy UI
    setTree((prev) => updateLocal(prev, selected.id, patch));
    try {
      await updateElement(selected.id, patch);
    } catch (e: any) { setError(e.message); }
  }

  function updateLocal(ns: PageElementNode[], id: string, patch: any): PageElementNode[] {
    return ns.map((n) => {
      if (n.id === id) {
        return {
          ...n,
          settings: patch.settings ? { ...n.settings, ...patch.settings } : n.settings,
          style: patch.style ? { ...n.style, ...patch.style } : n.style,
          responsive: patch.responsive ? { ...n.responsive, ...patch.responsive } : n.responsive,
          advanced: patch.advanced ? { ...n.advanced, ...patch.advanced } : n.advanced,
        };
      }
      return { ...n, children: updateLocal(n.children, id, patch) };
    });
  }

  async function makeRevision() {
    if (!activePageId) return;
    try {
      await createRevision(activePageId, 'manual save');
      const r = await listRevisions(activePageId);
      setRevisions(r.revisions);
      alert('Revision saved');
    } catch (e: any) { setError(e.message); }
  }

  async function openRevisions() {
    if (!activePageId) return;
    try {
      const r = await listRevisions(activePageId);
      setRevisions(r.revisions);
      setShowRevisions(true);
    } catch (e: any) { setError(e.message); }
  }

  async function doRestoreRevision(revId: string) {
    if (!confirm('Restore this revision? Current tree will be replaced.')) return;
    try {
      await restoreRevision(revId);
      setShowRevisions(false);
      if (activePageId) await reloadTree(activePageId);
    } catch (e: any) { setError(e.message); }
  }

  async function openTemplates() {
    try {
      const r = await listTemplates();
      setTemplates(r.templates);
      setShowTemplates(true);
    } catch (e: any) { setError(e.message); }
  }

  async function applyTpl(tid: string, replace: boolean) {
    if (!activePageId) return;
    try {
      await applyTemplate(activePageId, tid, replace);
      setShowTemplates(false);
      await reloadTree(activePageId);
    } catch (e: any) { setError(e.message); }
  }

  async function saveAsTpl() {
    if (!activePageId) return;
    const name = prompt('Template name?');
    if (!name) return;
    try {
      await savePageAsTemplate(activePageId, { name, category: 'custom' });
      alert('Saved as template');
    } catch (e: any) { setError(e.message); }
  }

  async function updateGlobal(kind: string, key: string, value: string, label?: string) {
    try {
      const g = await setGlobalStyle({ kind, key, value, label });
      setGlobalStyles((prev) => {
        const others = prev.filter((x) => !(x.kind === kind && x.key === key));
        return [...others, g];
      });
    } catch (e: any) { setError(e.message); }
  }

  // ---- drag handlers ----
  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as { widgetType?: string } | undefined;
    if (data?.widgetType) setDraggingWidgetType(data.widgetType);
  }

  async function handleDragEnd(e: DragEndEvent) {
    setDraggingWidgetType(null);
    if (!activePageId) return;
    const overId = e.over?.id as string | undefined;
    const activeData = e.active.data.current as { widgetType?: string; elementId?: string } | undefined;
    if (!overId) return;

    // Case A: palette widget dropped onto a container or between siblings
    if (activeData?.widgetType) {
      // Drop onto a container → insert inside; drop onto a widget/container → insert as sibling after
      let parentId: string | null = null;
      const dropEl = findElement(tree, overId);
      if (dropEl) {
        if (dropEl.element_type === 'section' || dropEl.element_type === 'container' || dropEl.element_type === 'column') {
          // Drop into container; if section has a column child use that
          const col = dropEl.children.find((c) => c.element_type === 'column');
          if (dropEl.element_type === 'section' && col) parentId = col.id;
          else parentId = dropEl.id;
        } else {
          parentId = dropEl.parent_id;
        }
      }
      try {
        const def = widgets.find((w) => w.type === activeData.widgetType);
        await addElement(activePageId, {
          parent_id: parentId,
          element_type: 'widget',
          widget_type: activeData.widgetType,
          settings: (def?.default_settings ?? {}) as Record<string, unknown>,
          style: (def?.default_style ?? {}) as Record<string, unknown>,
        });
        await reloadTree(activePageId);
      } catch (err: any) { setError(err.message); }
      return;
    }

    // Case B: existing element dragged onto another → move/reorder
    if (activeData?.elementId && activeData.elementId !== overId) {
      const dragged = findElement(tree, activeData.elementId);
      const target = findElement(tree, overId);
      if (!dragged || !target) return;
      try {
        // if target is a container → move inside
        if (target.element_type === 'section' || target.element_type === 'container' || target.element_type === 'column') {
          const col = target.children.find((c) => c.element_type === 'column');
          const newParent = target.element_type === 'section' && col ? col.id : target.id;
          await moveElement(dragged.id, { new_parent_id: newParent });
        } else {
          // reorder: move under same parent, before target's sort_order
          await moveElement(dragged.id, { new_parent_id: target.parent_id, new_sort_order: target.sort_order - 1 });
        }
        await reloadTree(activePageId);
      } catch (err: any) { setError(err.message); }
    }
  }

  // ---- render ----
  if (loading && !tree.length) return <div className="mf-page">Loading builder…</div>;
  if (!pages.length) return (
    <div className="mf-page">
      <h2>Page Builder</h2>
      <p>No pages yet. Create a custom page first in <b>Settings → Pages</b>.</p>
    </div>
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="mf-builder">
      {/* ===== Top bar ===== */}
      <div className="mf-builder-topbar">
        <select value={activePageId ?? ''} onChange={(e) => { setActivePageId(e.target.value); setSelectedId(null); }}>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.slug})</option>)}
        </select>
        <div className="mf-builder-actions">
          <button className="mf-btn" onClick={addSection}>+ Section</button>
          <button className="mf-btn" onClick={makeRevision}>💾 Save revision</button>
          <button className="mf-btn" onClick={openRevisions}>🕘 History</button>
          <button className="mf-btn" onClick={openTemplates}>📚 Templates</button>
          <button className="mf-btn" onClick={saveAsTpl}>⭐ Save as template</button>
        </div>
        <div className="mf-builder-devices">
          {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
            <button key={d} className={`mf-dev-btn ${device === d ? 'active' : ''}`} onClick={() => setDevice(d)}>
              {d === 'desktop' ? '🖥' : d === 'tablet' ? '📱' : '📱'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mf-banner-error" onClick={() => setError(null)}>⚠ {error} <span style={{ float: 'right' }}>×</span></div>}

      <div className="mf-builder-body">
        {/* ===== Left: widgets palette ===== */}
        <aside className="mf-builder-palette">
          <h4>Widgets</h4>
          <div className="mf-widget-filter">
            {['all', 'basic', 'media', 'layout', 'form', 'pro', 'dynamic'].map((c) => (
              <button key={c} className={`mf-tag ${widgetFilter === c ? 'active' : ''}`} onClick={() => setWidgetFilter(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="mf-widget-list">
            {filteredWidgets.map((w) => (
              <DraggableWidget key={w.type} widget={w} onAdd={() => addWidget(w.type)} />
            ))}
          </div>
        </aside>

        {/* ===== Center: canvas ===== */}
        <main className={`mf-builder-canvas device-${device}`} onClick={() => setSelectedId(null)}>
          {tree.length === 0 && (
            <div className="mf-canvas-empty">
              <p>Empty page.</p>
              <p>Click <b>+ Section</b> to start, then add widgets from the left.</p>
            </div>
          )}
          {tree.map((node) => (
            <CanvasNode key={node.id} node={node} selectedId={selectedId} onSelect={setSelectedId} device={device} />
          ))}
        </main>

        {/* ===== Right: inspector ===== */}
        <aside className="mf-builder-inspector">
          {!selected && <div className="mf-insp-empty">Select an element to edit its properties</div>}
          {selected && (
            <>
              <div className="mf-insp-header">
                <b>{selected.widget_type ?? selected.element_type}</b>
                <div>
                  <button className="mf-icon-btn" onClick={duplicateSelected} title="Duplicate">⧉</button>
                  <button className="mf-icon-btn danger" onClick={removeSelected} title="Delete">🗑</button>
                </div>
              </div>
              <div className="mf-insp-tabs">
                {(['content', 'style', 'advanced'] as const).map((t) => (
                  <button key={t} className={`mf-insp-tab ${inspectorTab === t ? 'active' : ''}`} onClick={() => setInspectorTab(t)}>{t}</button>
                ))}
              </div>
              <div className="mf-insp-body">
                {inspectorTab === 'content' && (
                  <ContentTab selected={selected} onChange={(settings) => updateSelected({ settings })} />
                )}
                {inspectorTab === 'style' && (
                  <StyleTab selected={selected} onChange={(style) => updateSelected({ style })} device={device}
                    onChangeResponsive={(resp) => updateSelected({ responsive: resp })} />
                )}
                {inspectorTab === 'advanced' && (
                  <AdvancedTab selected={selected}
                    onChange={(advanced) => updateSelected({ advanced })} />
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ===== Modals ===== */}
      {showRevisions && (
        <div className="mf-modal-bg" onClick={() => setShowRevisions(false)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Revision History</h3>
            {revisions.length === 0 && <p>No revisions yet.</p>}
            <ul className="mf-rev-list">
              {revisions.map((r) => (
                <li key={r.id}>
                  <div>
                    <div><b>{r.note ?? 'autosave'}</b></div>
                    <small>{new Date(r.created_at).toLocaleString()}</small>
                  </div>
                  <button className="mf-btn" onClick={() => doRestoreRevision(r.id)}>Restore</button>
                </li>
              ))}
            </ul>
            <button className="mf-btn" onClick={() => setShowRevisions(false)}>Close</button>
          </div>
        </div>
      )}

      {showTemplates && (
        <div className="mf-modal-bg" onClick={() => setShowTemplates(false)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Templates</h3>
            {templates.length === 0 && <p>No templates saved.</p>}
            <ul className="mf-rev-list">
              {templates.map((t) => (
                <li key={t.id}>
                  <div>
                    <div><b>{t.name}</b> {t.category && <span className="mf-tag">{t.category}</span>}</div>
                    <small>{t.snapshot.length} root nodes</small>
                  </div>
                  <div>
                    <button className="mf-btn" onClick={() => applyTpl(t.id, false)}>Append</button>
                    <button className="mf-btn" onClick={() => applyTpl(t.id, true)}>Replace</button>
                  </div>
                </li>
              ))}
            </ul>
            <button className="mf-btn" onClick={() => setShowTemplates(false)}>Close</button>
          </div>
        </div>
      )}

      {/* ===== Global styles bar ===== */}
      <div className="mf-global-bar">
        <b>Global:</b>
        <GlobalColorInput label="Primary" kind="color" gkey="primary" value={globalStyles.find((g) => g.kind === 'color' && g.key === 'primary')?.value ?? '#e50914'} onChange={updateGlobal} />
        <GlobalColorInput label="Secondary" kind="color" gkey="secondary" value={globalStyles.find((g) => g.kind === 'color' && g.key === 'secondary')?.value ?? '#221f1f'} onChange={updateGlobal} />
        <GlobalColorInput label="Bg" kind="color" gkey="bg" value={globalStyles.find((g) => g.kind === 'color' && g.key === 'bg')?.value ?? '#0b0b0b'} onChange={updateGlobal} />
        <GlobalColorInput label="Text" kind="color" gkey="text" value={globalStyles.find((g) => g.kind === 'color' && g.key === 'text')?.value ?? '#f5f5f5'} onChange={updateGlobal} />
      </div>
    </div>
    <DragOverlay>
      {draggingWidgetType && (
        <div className="mf-drag-overlay">
          {widgets.find((w) => w.type === draggingWidgetType)?.label ?? draggingWidgetType}
        </div>
      )}
    </DragOverlay>
    </DndContext>
  );
}

function GlobalColorInput({ label, kind, gkey, value, onChange }: { label: string; kind: string; gkey: string; value: string; onChange: (kind: string, key: string, value: string, label?: string) => void }) {
  return (
    <label className="mf-global-input">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(kind, gkey, e.target.value, label)} />
    </label>
  );
}

// ============ Canvas node ============

function CanvasNode({ node, selectedId, onSelect, device }: { node: PageElementNode; selectedId: string | null; onSelect: (id: string) => void; device: Device }) {
  const isContainer = node.element_type === 'section' || node.element_type === 'column' || node.element_type === 'container';
  const style = node.style as Record<string, any>;
  const css: React.CSSProperties = {};
  if (style.background_color) css.background = style.background_color;
  if (style.padding) css.padding = style.padding;
  if (style.margin) css.margin = style.margin;
  if (style.width) css.width = style.width;
  if (style.min_height) css.minHeight = style.min_height;
  if (node.element_type === 'column') { css.flex = 1; css.minWidth = 0; }

  const { setNodeRef, isOver } = useDroppable({ id: node.id, data: { elementId: node.id } });

  if (isContainer) {
    return (
      <div
        ref={setNodeRef}
        className={`mf-cnode mf-cnode-${node.element_type} ${selectedId === node.id ? 'selected' : ''} ${isOver ? 'over' : ''}`}
        style={{ display: 'flex', flexDirection: node.element_type === 'column' ? 'column' : 'row', gap: 8, ...css }}
        onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
        data-el-id={node.id}
      >
        {node.children.length === 0 && (
          <div className="mf-cnode-empty">Drop widget here</div>
        )}
        {node.children.map((c) => (
          <CanvasNode key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} device={device} />
        ))}
      </div>
    );
  }

  // widget node — also droppable so others can be placed after
  return (
    <div ref={setNodeRef} className={isOver ? 'mf-widget-drop-over' : ''}>
      <WidgetPreview element={node} selected={selectedId === node.id} onSelect={onSelect} />
    </div>
  );
}

// ============ Draggable widget (palette) ============

function DraggableWidget({ widget, onAdd }: { widget: WidgetDefinition; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${widget.type}`,
    data: { widgetType: widget.type },
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`mf-widget-btn ${isDragging ? 'dragging' : ''}`}
      onClick={onAdd}
      title={`${widget.type} — drag onto canvas or click to add`}
      style={{ cursor: 'grab' }}
    >
      <span>{widget.label}</span>
      <small>{widget.category}</small>
    </button>
  );
}

// ============ Inspector tabs ============

function ContentTab({ selected, onChange }: { selected: PageElementNode; onChange: (s: Record<string, unknown>) => void }) {
  const s = selected.settings as Record<string, any>;
  const wt = selected.widget_type ?? '';

  const field = (key: string, label: string, type = 'text') => (
    <label className="mf-field">
      {label}
      <input type={type} value={s[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })} />
    </label>
  );
  const area = (key: string, label: string) => (
    <label className="mf-field">
      {label}
      <textarea rows={3} value={s[key] ?? ''} onChange={(e) => onChange({ [key]: e.target.value })} />
    </label>
  );

  switch (wt) {
    case 'heading':
      return <>{field('text', 'Text')}
        <label className="mf-field">Tag
          <select value={s.tag ?? 'h2'} onChange={(e) => onChange({ tag: e.target.value })}>
            {['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label></>;
    case 'text':
      return area('html', 'HTML');
    case 'button':
      return <>{field('text', 'Label')}{field('url', 'URL')}
        <label className="mf-field">Target
          <select value={s.target ?? '_self'} onChange={(e) => onChange({ target: e.target.value })}>
            <option>_self</option><option>_blank</option>
          </select>
        </label></>;
    case 'image':
      return <>{field('src', 'Image URL')}{field('alt', 'Alt')}</>;
    case 'video':
      return <>{field('src', 'Video URL')}
        <label className="mf-field">Provider
          <select value={s.provider ?? 'html5'} onChange={(e) => onChange({ provider: e.target.value })}>
            {['html5', 'youtube', 'vimeo'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </label></>;
    case 'audio':
      return field('src', 'Audio URL');
    case 'spacer':
      return <label className="mf-field">Height (px)
        <input type="number" value={s.height ?? 40} onChange={(e) => onChange({ height: Number(e.target.value) })} />
      </label>;
    case 'counter':
      return <>{field('start', 'Start', 'number')}{field('end', 'End', 'number')}{field('duration', 'Duration (s)', 'number')}</>;
    case 'progress':
      return <>{field('value', 'Value %', 'number')}{field('label', 'Label')}</>;
    case 'testimonial':
      return <>{area('quote', 'Quote')}{field('author', 'Author')}{field('role', 'Role')}</>;
    case 'alert':
      return <>{field('text', 'Text')}
        <label className="mf-field">Type
          <select value={s.type ?? 'info'} onChange={(e) => onChange({ type: e.target.value })}>
            {['info', 'success', 'warning', 'danger'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label></>;
    case 'html':
      return area('html', 'HTML');
    case 'shortcode':
      return field('code', 'Shortcode');
    case 'search':
      return field('placeholder', 'Placeholder');
    case 'dyn_trending_grid':
    case 'dyn_content_type_grid':
      return <>{field('content_type', 'Content Type')}<label className="mf-field">Per page
        <input type="number" value={s.per_page ?? 12} onChange={(e) => onChange({ per_page: Number(e.target.value) })} />
      </label></>;
    default:
      return <pre className="mf-json">{JSON.stringify(s, null, 2)}</pre>;
  }
}

function StyleTab({ selected, onChange, device, onChangeResponsive }: {
  selected: PageElementNode; onChange: (s: Record<string, unknown>) => void;
  device: Device; onChangeResponsive: (r: Record<string, unknown>) => void;
}) {
  const respOverrides = (selected.responsive[device] ?? {}) as Record<string, any>;
  const s = device === 'desktop' ? (selected.style as Record<string, any>) : { ...(selected.style as Record<string, any>), ...respOverrides };
  const set = (k: string, v: unknown) => {
    if (device === 'desktop') onChange({ [k]: v });
    else onChangeResponsive({ [device]: { ...respOverrides, [k]: v } });
  };
  return (
    <div className="mf-style-form">
      <label className="mf-field">Text color
        <input type="color" value={s.color ?? '#ffffff'} onChange={(e) => set('color', e.target.value)} />
      </label>
      <label className="mf-field">Background
        <input type="color" value={s.background_color ?? '#000000'} onChange={(e) => set('background_color', e.target.value)} />
      </label>
      <label className="mf-field">Font size (px)
        <input type="number" value={s.font_size ?? ''} onChange={(e) => set('font_size', Number(e.target.value))} />
      </label>
      <label className="mf-field">Font weight
        <select value={s.font_weight ?? ''} onChange={(e) => set('font_weight', e.target.value)}>
          <option value="">—</option>
          {[100,200,300,400,500,600,700,800,900].map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </label>
      <label className="mf-field">Align
        <select value={s.text_align ?? ''} onChange={(e) => set('text_align', e.target.value)}>
          <option value="">—</option>
          <option value="left">left</option>
          <option value="center">center</option>
          <option value="right">right</option>
        </select>
      </label>
      <label className="mf-field">Padding (CSS)
        <input value={s.padding ?? ''} onChange={(e) => set('padding', e.target.value)} placeholder="16px 24px" />
      </label>
      <label className="mf-field">Margin (CSS)
        <input value={s.margin ?? ''} onChange={(e) => set('margin', e.target.value)} placeholder="8px 0" />
      </label>
      <label className="mf-field">Border radius
        <input value={s.border_radius ?? ''} onChange={(e) => set('border_radius', e.target.value)} placeholder="4px" />
      </label>
      <label className="mf-field">Border
        <input value={s.border ?? ''} onChange={(e) => set('border', e.target.value)} placeholder="1px solid #444" />
      </label>
      {device !== 'desktop' && <div className="mf-hint">Editing <b>{device}</b> overrides</div>}
    </div>
  );
}

function AdvancedTab({ selected, onChange }: { selected: PageElementNode; onChange: (a: Record<string, unknown>) => void }) {
  const a = selected.advanced as Record<string, any>;
  return (
    <div className="mf-style-form">
      <label className="mf-field">Custom CSS
        <textarea rows={6} value={a.custom_css ?? ''} onChange={(e) => onChange({ custom_css: e.target.value })} placeholder="color: red; font-size: 20px;" />
      </label>
      <label className="mf-field">Custom JS
        <textarea rows={6} value={a.custom_js ?? ''} onChange={(e) => onChange({ custom_js: e.target.value })} placeholder="this.addEventListener('click', () => alert('hi'));" />
      </label>
      <label className="mf-field">Z-index
        <input type="number" value={a.z_index ?? ''} onChange={(e) => onChange({ z_index: Number(e.target.value) })} />
      </label>
    </div>
  );
}
