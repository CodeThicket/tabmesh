---
title: Playground
layout: page
---

<style scoped>
.pg-frame {
  width: 100%;
  min-height: calc(100vh - 240px);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.pg-help {
  margin: 16px 0 24px;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
  border-left: 4px solid var(--vp-c-brand-1);
  border-radius: 4px;
  font-size: 14px;
}
</style>

<div class="VPDoc has-aside">
  <div class="container">
    <div class="content">
      <div class="content-container">
        <h1>Playground</h1>
        <div class="pg-help">
          A live multi-tab demo. Open this page in two browser tabs to see TabMesh sharing a single WebSocket and broadcasting <code>todo.add</code> / <code>todo.complete</code> / <code>todo.delete</code> events between them. The activity feed shows <code>LOCAL</code> vs <code>REMOTE</code> classification and the system events the mesh is emitting.
        </div>
        <iframe
          class="pg-frame"
          src="/playground/index.html"
          title="TabMesh playground"
          loading="lazy"
        ></iframe>
      </div>
    </div>
  </div>
</div>
