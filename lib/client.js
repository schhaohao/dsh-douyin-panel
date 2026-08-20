window.__ModuleLoader__.load({
	id: "dsh-douyin-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.tsx
		/**
		* Douyin panel — browser half.
		*
		* Contributes one additive `shell.overlay` entry that behaves like the app's
		* own right-hand column instead of a floating layer: while the dock is open
		* this plugin deputizes the AppFrame grid's third track (observing the frame
		* element and overriding its inline grid-template-columns, with full cleanup
		* on close/unload), so the conversation column genuinely squeezes against the
		* Douyin dock. Opening the dock also collapses the sidebar through the
		* sanctioned ctx.layout panel actions (restored on close if nothing else
		* touched it). The content iframes the host half's loopback Douyin mirror
		* (see src/index.mjs).
		*/
		/** Required client services: slot registration + the panel-action contract. */
		const inject = ["slots", "layout"];
		/** Well-known route the host half serves the mirror origin through. */
		const META_URL = "/douyin-panel/meta";
		const OPEN_KEY = "dsh-douyin:open";
		const WIDTH_KEY = "dsh-douyin:width";
		/** Width until the iframe reports its content's own natural width. */
		const DEFAULT_WIDTH = 380;
		/** The grip never lets the dock go under/over these; no other caps exist. */
		const DOCK_MIN = 120;
		const NATURAL_MIN = 260;
		const NATURAL_MAX = 720;
		/**
		* The ONLY floor the conversation column keeps — no 640 contract here. Chain
		* per the owner's call: sidebar is sacred → the CENTER concedes all the way
		* to this floor → only then does the dock concede toward DOCK_MIN → and
		* finally it hides (subtree mounted), reviving on widening.
		*/
		const CENTER_FLOOR = 240;
		const STYLE_TAG_ID = "dsh-douyin-panel/styles";
		const CSS = `
[data-douyin-panel] { position: absolute; top: 0; right: 0; height: 100%; font-family: inherit; }
[data-douyin-panel] .douyin-tab {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  border: none;
  border-radius: 8px 0 0 8px;
  padding: 14px 7px;
  cursor: pointer;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #161823 0%, #fe2c55 130%);
  box-shadow: -2px 2px 12px rgba(0, 0, 0, 0.35);
  transition: padding 120ms ease;
}
[data-douyin-panel] .douyin-tab:hover { padding-right: 12px; }
[data-douyin-panel] .douyin-dock {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  overflow: hidden;
  /* 开合动画 = transform 位移（GPU 合成），与 frame 轨道同一支曲线同一支时长 ——
     两个平面同步到亚像素，且 iframe 永不再排（视频区不 jitter）。 */
  transition: transform var(--ds-transition-duration-slow, 240ms) var(--ds-ease-in-out, ease);
  will-change: transform;
}
[data-douyin-panel] .douyin-dock[data-dragging='true'] { transition: none; }
[data-douyin-panel] .douyin-root {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base, #101014);
  /* The seam is light and air, not a rule line: deep soft shadow + a
     gradient hairline that fades at both ends. */
  box-shadow: -16px 0 40px -12px rgba(0, 0, 0, 0.55);
}
[data-douyin-panel] .douyin-root::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
  background: linear-gradient(to bottom, transparent 0%, var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18)) 18%, var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18)) 82%, transparent 100%);
  pointer-events: none;
}
[data-douyin-panel] .douyin-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 73px;
  flex: none;
  padding: 0 6px 0 14px;
  color: var(--dsw-alias-text-primary, #e8e8eb);
  background: var(--dsw-specific-sidebar-fill, #16161c);
  user-select: none;
}
[data-douyin-panel] .douyin-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
[data-douyin-panel] .douyin-title .douyin-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fe2c55;
  flex: none;
}
[data-douyin-panel] .douyin-action {
  border: none;
  background: transparent;
  color: var(--dsw-alias-text-secondary, #a0a0ab);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  white-space: nowrap;
}
[data-douyin-panel] .douyin-action:hover { background: rgba(127, 127, 147, 0.16); color: var(--dsw-alias-text-primary, #fff); }
[data-douyin-panel] .douyin-body { flex: 1; min-height: 0; position: relative; }
[data-douyin-panel] .douyin-body iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #000;
}
[data-douyin-panel] .douyin-status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  color: var(--dsw-alias-text-secondary, #a0a0ab);
  font-size: 12.5px;
  line-height: 1.7;
  background: var(--dsw-alias-bg-base, #101014);
  z-index: 1;
}
[data-douyin-panel] .douyin-status .douyin-retry {
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
  background: transparent;
  color: var(--dsw-alias-text-primary, #e8e8eb);
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12.5px;
}
[data-douyin-panel] .douyin-status .douyin-retry:hover { background: rgba(127, 127, 147, 0.16); }
[data-douyin-panel] .douyin-bridge {
  position: absolute;
  top: 48px;
  right: 8px;
  left: 8px;
  z-index: 3;
  border-radius: 10px;
  padding: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--dsw-alias-text-primary, #e8e8eb);
  background: var(--dsw-specific-sidebar-fill, #17171d);
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
[data-douyin-panel] .douyin-bridge-title { font-weight: 600; margin-bottom: 8px; }
[data-douyin-panel] .douyin-bridge-note { color: var(--dsw-alias-text-secondary, #a0a0ab); margin: 6px 0; white-space: pre-wrap; word-break: break-all; }
[data-douyin-panel] .douyin-bridge-note.ok { color: #22c55e; }
[data-douyin-panel] .douyin-bridge-note code {
  background: rgba(127, 127, 147, 0.2);
  padding: 0 4px;
  border-radius: 4px;
  font-size: 11.5px;
}
[data-douyin-panel] .douyin-bridge-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  margin: 6px 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.15));
  background: var(--dsw-alias-bg-base, #101014);
  color: var(--dsw-alias-text-primary, #e8e8eb);
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
[data-douyin-panel] .douyin-bridge-input:focus-visible { outline: 1px solid #fe2c55; }
[data-douyin-panel] .douyin-bridge-row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
[data-douyin-panel] .douyin-bridge-btn {
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16));
  background: transparent;
  color: var(--dsw-alias-text-primary, #e8e8eb);
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
[data-douyin-panel] .douyin-bridge-btn:hover { background: rgba(127, 127, 147, 0.16); }
[data-douyin-panel] .douyin-bridge-btn.primary { background: #fe2c55; border-color: #fe2c55; color: #fff; }
[data-douyin-panel] .douyin-bridge-btn.primary:hover { background: #e0244a; }
[data-douyin-panel] .douyin-bridge-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
[data-douyin-panel] .douyin-bridge-btn.danger { color: #f87171; border-color: rgba(248, 113, 113, 0.4); }
[data-douyin-panel] .douyin-grip {
  position: absolute;
  top: 0;
  left: -6px;
  width: 14px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
  touch-action: none;
}
[data-douyin-panel] .douyin-grip::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 32px;
  border-radius: 10px;
  box-sizing: border-box;
  background: var(--dsw-alias-button-floating-fill, rgba(255, 255, 255, 0.12));
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16));
  opacity: 0;
  transition: opacity 120ms ease;
}
[data-douyin-panel] .douyin-grip:hover::after,
[data-douyin-panel] .douyin-grip[data-dragging='true']::after { opacity: 1; }
`;
		/** Read a JSON value out of localStorage, falling back when absent or corrupt. */
		function readPersisted(key, fallback) {
			try {
				const raw = localStorage.getItem(key);
				return raw === null ? fallback : JSON.parse(raw);
			} catch {
				return fallback;
			}
		}
		/** Write one localStorage key; quota/privacy failures are cosmetic here. */
		function writePersisted(key, value) {
			try {
				localStorage.setItem(key, JSON.stringify(value));
			} catch {}
		}
		/** The grip's only clamp — free adjustment otherwise. */
		function clampDock(px) {
			return Math.max(DOCK_MIN, Math.round(px));
		}
		/** Parse `${S}px minmax(0, 1fr) ${D}px` — only the sidebar track matters here. */
		function sidebarTrackOf(frame) {
			const match = /^(\d+(?:\.\d+)?)px\s/.exec(frame.style.gridTemplateColumns);
			return match === null ? void 0 : parseFloat(match[1]);
		}
		/**
		* The AppFrame element above this entry: walk ancestors until ui-layout's
		* `[data-shell-overlay]` marker — the entry wrapper chain in between
		* (data-slot error boundaries etc.) is the renderer's business, not mine.
		*/
		function frameOf(el) {
			let cur = el?.parentElement ?? null;
			while (cur !== null) {
				if (cur.hasAttribute("data-shell-overlay")) return cur.parentElement;
				cur = cur.parentElement;
			}
			return null;
		}
		/**
		* The deputy-solver: while the dock is open, own the frame's third track.
		* Chain: sidebar is sacred → the DOCK keeps its chosen width → the center
		* column concedes down to CENTER_SOFT_MIN → only then the dock concedes to
		* DOCK_MIN → and finally hides (subtree stays mounted at width 0). The
		* frame's own inline style is restored exactly on cleanup.
		*
		* @returns rendered dock width (0 = conceded/hidden).
		*/
		function useDockDeputy(dockRef, open, wantWidth) {
			const [rendered, setRendered] = (0, react.useState)(0);
			const applyRef = (0, react.useRef)(() => {});
			/** Live copy of wantWidth — the deputy setup closure must not capture a stale drag tick. */
			const wantRef = (0, react.useRef)(wantWidth);
			(0, react.useEffect)(() => {
				wantRef.current = wantWidth;
				applyRef.current();
			}, [wantWidth]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const frame = frameOf(dockRef.current);
				if (frame == null) return;
				/** The last column string this hook wrote (distinguishes own writes from React's). */
				let lastWritten = "";
				/** React's most recent own column string, restored verbatim on cleanup. */
				let reactColumns;
				const solve = () => {
					const sidebar = sidebarTrackOf(frame) ?? 0;
					const viewport = frame.clientWidth;
					const want = clampDock(wantRef.current);
					const fit = viewport - sidebar - CENTER_FLOOR;
					if (fit < DOCK_MIN) return 0;
					return Math.min(want, fit);
				};
				const apply = () => {
					const w = solve();
					setRendered((prev) => prev === w ? prev : w);
					if (w === 0) {
						if (lastWritten !== "" && frame.style.gridTemplateColumns === lastWritten && reactColumns !== void 0) {
							frame.style.gridTemplateColumns = reactColumns;
							lastWritten = "";
						}
						return;
					}
					const sidebar = sidebarTrackOf(frame) ?? 0;
					const columns = `${String(sidebar)}px ${String(frame.clientWidth - sidebar - w)}px ${String(w)}px`;
					if (frame.style.gridTemplateColumns !== columns) {
						frame.style.gridTemplateColumns = columns;
						lastWritten = columns;
					}
				};
				const observer = new MutationObserver(() => {
					const current = frame.style.gridTemplateColumns;
					if (current !== lastWritten) reactColumns = current;
					apply();
				});
				observer.observe(frame, {
					attributes: true,
					attributeFilter: ["style"]
				});
				const ro = new ResizeObserver(() => {
					apply();
				});
				ro.observe(frame);
				applyRef.current = apply;
				apply();
				return () => {
					observer.disconnect();
					ro.disconnect();
					applyRef.current = () => {};
					if (lastWritten !== "" && frame.style.gridTemplateColumns === lastWritten && reactColumns !== void 0) frame.style.gridTemplateColumns = reactColumns;
					setRendered(0);
				};
			}, [dockRef, open]);
			return rendered;
		}
		/**
		* Sidebar bookkeeping for dock open/close through ctx.layout: collapse on
		* open, restore on close — but only if nothing else toggled it meanwhile.
		*/
		function useSidebarHandshake(layout, dockRef, open) {
			(0, react.useEffect)(() => {
				if (!open) return;
				const frame = frameOf(dockRef.current);
				if (frame == null) return;
				const sidebar = sidebarTrackOf(frame);
				const wasOpen = sidebar !== void 0 && sidebar > 60;
				layout.closeDetails();
				if (wasOpen) layout.toggleSidebar();
				return () => {
					if (!wasOpen) return;
					const now = sidebarTrackOf(frame);
					if (now !== void 0 && now <= 60) layout.toggleSidebar();
				};
			}, [
				layout,
				dockRef,
				open
			]);
		}
		/** The additive overlay occupant: dock-or-tab. */
		function DouyinPanel({ layout }) {
			const [open, setOpen] = (0, react.useState)(() => readPersisted(OPEN_KEY, false));
			/** The dock OUT while its slide-out animation lands — 视觉 still ON stage. */
			const [closing, setClosing] = (0, react.useState)(false);
			const [customWidth, setCustomWidth] = (0, react.useState)(() => {
				const persisted = readPersisted(WIDTH_KEY, 0);
				return persisted > 0 ? persisted : void 0;
			});
			const [meta, setMeta] = (0, react.useState)(void 0);
			const [metaError, setMetaError] = (0, react.useState)(void 0);
			const [contentWidth, setContentWidth] = (0, react.useState)(0);
			const [loaded, setLoaded] = (0, react.useState)(false);
			const [nonce, setNonce] = (0, react.useState)(0);
			const [dragging, setDragging] = (0, react.useState)(false);
			const dockRef = (0, react.useRef)(null);
			const dockInnerRef = (0, react.useRef)(null);
			const gripRef = (0, react.useRef)(null);
			const dragBase = (0, react.useRef)(0);
			const wantWidth = clampDock(customWidth ?? (contentWidth > 0 ? Math.min(NATURAL_MAX, Math.max(NATURAL_MIN, contentWidth)) : DEFAULT_WIDTH));
			const rendered = useDockDeputy(dockRef, open, wantWidth);
			useSidebarHandshake(layout, dockRef, open);
			const fetchMeta = (0, react.useCallback)(() => {
				setMetaError(void 0);
				fetch(META_URL, { cache: "no-store" }).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
					return await res.json();
				}).then(setMeta).catch((error) => {
					setMetaError(error instanceof Error ? error.message : String(error));
				});
			}, []);
			(0, react.useEffect)(() => {
				if (open && meta === void 0 && metaError === void 0) fetchMeta();
			}, [
				open,
				meta,
				metaError,
				fetchMeta
			]);
			(0, react.useEffect)(() => {
				if (!open || meta === void 0 || customWidth !== void 0) return;
				const mirrorOrigin = new URL(meta.url).origin;
				const onMessage = (event) => {
					if (event.origin !== mirrorOrigin) return;
					const data = event.data;
					if (data?.__douyinPanel !== true || data.kind !== "content-fit") return;
					const cw = typeof data.clientWidth === "number" ? Math.round(data.clientWidth) : 0;
					const overflow = typeof data.overflowPx === "number" ? Math.round(data.overflowPx) : 0;
					if (cw > 0 && overflow > 0) setContentWidth(cw + overflow);
				};
				window.addEventListener("message", onMessage);
				return () => {
					window.removeEventListener("message", onMessage);
				};
			}, [
				open,
				meta,
				customWidth
			]);
			const toggle = () => {
				if (open) {
					setOpen(false);
					setClosing(true);
				} else setOpen(true);
				writePersisted(OPEN_KEY, !open);
			};
			/** Unstage the dock once its slide-out transition lands. */
			const onClosingEnd = () => {
				setClosing(false);
			};
			const refresh = () => {
				setLoaded(false);
				setNonce((n) => n + 1);
			};
			const [bridgeOpen, setBridgeOpen] = (0, react.useState)(false);
			const [bridgeText, setBridgeText] = (0, react.useState)("");
			const [bridgeNote, setBridgeNote] = (0, react.useState)(void 0);
			const [bridgeImported, setBridgeImported] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setBridgeImported(meta?.cookieImported === true);
			}, [meta]);
			/** The session bridge card: login happens at the REAL douyin.com (its own habitat —
			* out-of-scope for any risk debate), then one Cookie paste carries the session
			* into the mirror permanently. */
			const submitBridge = () => {
				setBridgeNote(void 0);
				fetch("/douyin-panel/cookies", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ header: bridgeText })
				}).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
					return await res.json();
				}).then(({ imported }) => {
					setBridgeNote(`✅ 已导入 ${String(imported)} 条 Cookie —— 面板现在就是你的登录态`);
					setBridgeText("");
					setBridgeImported(true);
					refresh();
				}).catch((error) => {
					setBridgeNote(`❌ 导入失败: ${error instanceof Error ? error.message : String(error)}`);
				});
			};
			const clearBridge = () => {
				fetch("/douyin-panel/cookies", { method: "DELETE" }).then((res) => {
					if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
					setBridgeNote("已清除 —— 回到游客态");
					setBridgeImported(false);
					refresh();
				}).catch((error) => {
					setBridgeNote(`清除失败: ${error instanceof Error ? error.message : String(error)}`);
				});
			};
			const onGripDown = (event) => {
				event.preventDefault();
				dragBase.current = wantWidth + event.clientX;
				gripRef.current?.setPointerCapture(event.pointerId);
				gripRef.current?.setAttribute("data-dragging", "true");
				frameOf(dockRef.current)?.setAttribute("data-dragging", "true");
				setDragging(true);
			};
			const onGripMove = (event) => {
				if (!gripRef.current?.hasPointerCapture(event.pointerId)) return;
				setCustomWidth(clampDock(dragBase.current - event.clientX));
			};
			const endGrip = (event) => {
				gripRef.current?.releasePointerCapture(event.pointerId);
				gripRef.current?.setAttribute("data-dragging", "false");
				frameOf(dockRef.current)?.removeAttribute("data-dragging");
				setDragging(false);
				if (customWidth !== void 0) writePersisted(WIDTH_KEY, customWidth);
			};
			const onGripDoubleClick = () => {
				setCustomWidth(void 0);
				setContentWidth(0);
				writePersisted(WIDTH_KEY, 0);
			};
			if (!(open || closing)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-douyin-panel": true,
				ref: dockRef,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "douyin-tab",
					title: "打开抖音面板",
					onClick: toggle,
					children: "抖音"
				})
			});
			const iframeUrl = meta === void 0 ? void 0 : `${meta.url}jingxuan?r=${String(nonce)}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-douyin-panel": true,
				ref: dockRef,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: dockInnerRef,
					className: "douyin-dock",
					style: {
						width: wantWidth,
						transform: `translateX(${String(open ? Math.max(0, wantWidth - rendered) : wantWidth)}px)`
					},
					"data-dragging": dragging || void 0,
					onTransitionEnd: closing ? onClosingEnd : void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "douyin-root",
						style: { width: wantWidth },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "douyin-header",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "douyin-title",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "douyin-dot" }), "抖音 · vibe time"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "douyin-action",
									title: "Cookie 桥 — 登录态管理",
									onClick: () => {
										setBridgeOpen((v) => !v);
										setBridgeNote(void 0);
									},
									children: bridgeImported ? "🔑 已登录" : "🔑 登录"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "douyin-action",
									title: "重新加载",
									onClick: refresh,
									children: "刷新"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "douyin-action",
									title: "在浏览器新标签页打开镜像",
									onClick: () => {
										if (meta !== void 0) window.open(meta.url, "_blank", "noopener");
									},
									children: "外开"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "douyin-action",
									title: "收起面板",
									onClick: toggle,
									children: "收起 ✕"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "douyin-body",
							children: [
								bridgeOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "douyin-bridge",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "douyin-bridge-title",
										children: "🔑 Cookie 桥 — 登录在真站打，镜像吃 Cookie"
									}), bridgeImported ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "douyin-bridge-note ok",
											children: "✅ 已桥接你的登录态"
										}),
										bridgeNote !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "douyin-bridge-note",
											children: bridgeNote
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "douyin-bridge-row",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "douyin-bridge-btn",
												onClick: () => {
													setBridgeOpen(false);
												},
												children: "关闭"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "douyin-bridge-btn danger",
												onClick: clearBridge,
												children: "清除 → 回到游客态"
											})]
										})
									] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "douyin-bridge-note",
											children: "① 在你自己的浏览器里登录 douyin.com"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "douyin-bridge-row",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "douyin-bridge-btn primary",
												onClick: () => {
													window.open("https://www.douyin.com/", "_blank", "noopener");
												},
												children: "打开 douyin.com 去登录 →"
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "douyin-bridge-note",
											children: [
												"② 登录后：F12 → Network → 任一请求 → 右键 Request Headers 里那行 ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "Cookie:" }),
												" → Copy value"
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											className: "douyin-bridge-input",
											placeholder: "③ Cookie 粘贴到这里（整行都行，我认得）",
											rows: 3,
											value: bridgeText,
											onChange: (e) => {
												setBridgeText(e.target.value);
											}
										}),
										bridgeNote !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "douyin-bridge-note",
											children: bridgeNote
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "douyin-bridge-row",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "douyin-bridge-btn",
												onClick: () => {
													setBridgeOpen(false);
												},
												children: "取消"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "douyin-bridge-btn primary",
												disabled: bridgeText.trim() === "",
												onClick: submitBridge,
												children: "导入并刷新"
											})]
										})
									] })]
								}),
								metaError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "douyin-status",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										"连不上本地抖音镜像（",
										metaError,
										"）。",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"插件的 host 半可能还没启动完成。"
									] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "douyin-retry",
										onClick: fetchMeta,
										children: "重试"
									})]
								}),
								metaError === void 0 && meta === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "douyin-status",
									children: "正在连接本地抖音镜像…"
								}),
								metaError === void 0 && meta !== void 0 && !loaded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "douyin-status",
									children: [
										"正在从 www.douyin.com 拉取推荐流…",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"首次加载稍慢；如果出现验证码，过一下就有了。"
									]
								}),
								iframeUrl !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
									src: iframeUrl,
									title: "抖音",
									referrerPolicy: "no-referrer",
									sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-presentation",
									allow: "autoplay; fullscreen; encrypted-media; picture-in-picture",
									onLoad: () => {
										setLoaded(true);
									}
								}, nonce)
							]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						ref: gripRef,
						className: "douyin-grip",
						title: "拖拽自由调宽 · 双击恢复内容原始宽度",
						onPointerDown: onGripDown,
						onPointerMove: onGripMove,
						onPointerUp: endGrip,
						onPointerCancel: endGrip,
						onDoubleClick: onGripDoubleClick
					})]
				})
			});
		}
		/**
		* Client plugin body: contribute the overlay entry as soon as ui-layout has
		* declared the slot (slots.inject waits for the declaration lifetime), plus
		* the standalone stylesheet. The inject factory hands the component the
		* sanctioned panel-action face — business data stays out of owner props.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
					const tag = document.createElement("style");
					tag.dataset.plugin = "dsh-douyin-panel";
					tag.dataset.pluginCss = STYLE_TAG_ID;
					tag.textContent = CSS;
					document.head.appendChild(tag);
					return () => {
						tag.remove();
					};
				}
				return () => {};
			}, "douyin-panel: styles");
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "douyin-panel",
				inject: () => ({ layout: ctx.layout })
			}, DouyinPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map