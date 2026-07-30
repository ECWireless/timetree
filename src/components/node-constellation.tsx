"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { MinusIcon, PlusIcon, ResetIcon } from "@/components/icons";
import {
  buildConstellationGraph,
  constellationDurationSeconds,
  staticConstellationPosition,
} from "@/lib/nodes/constellation";
import type { DashboardNode } from "@/lib/nodes/tree";
import { formatHistoricalDuration } from "@/lib/time-entries/duration";
import type { ActiveTimerRecord } from "@/lib/timers/contracts";

type LayoutNode = SimulationNodeDatum & {
  id: string;
  node: DashboardNode;
  radius: number;
};

type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  source: string | LayoutNode;
  target: string | LayoutNode;
};

type ViewTransform = {
  x: number;
  y: number;
  scale: number;
};

type DragState =
  | {
      kind: "canvas";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    }
  | {
      kind: "node";
      nodeId: string;
      pointerId: number;
    };

type NodeConstellationProps = {
  activeTimers: readonly ActiveTimerRecord[];
  nodes: readonly DashboardNode[];
  showCompleted: boolean;
  onCreateRoot: () => void;
  onOpenNode: (nodeId: string) => void;
  onShowCompleted: () => void;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.25;

function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Some mobile browsers do not support pointer capture on SVG groups.
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function labelForNode(node: DashboardNode) {
  const maximum = 22;
  return node.title.length <= maximum ? node.title : `${node.title.slice(0, maximum - 1)}…`;
}

function breadcrumbForNode(node: DashboardNode) {
  return node.breadcrumb.map(({ title }) => title).join(" / ");
}

function resolvedLinkNode(value: string | LayoutNode) {
  return typeof value === "string" ? null : value;
}

export function NodeConstellation({
  activeTimers,
  nodes,
  showCompleted,
  onCreateRoot,
  onOpenNode,
  onShowCompleted,
}: NodeConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<Simulation<LayoutNode, LayoutLink> | null>(null);
  const layoutNodesRef = useRef<LayoutNode[]>([]);
  const dragStateRef = useRef<DragState | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const openNodeButtonRef = useRef<HTMLButtonElement>(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 620 });
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [renderNodes, setRenderNodes] = useState<LayoutNode[]>([]);
  const [resetVersion, setResetVersion] = useState(0);
  const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const graph = useMemo(
    () => buildConstellationGraph(nodes, showCompleted),
    [nodes, showCompleted],
  );
  const activeNodeIds = useMemo(
    () => new Set(activeTimers.map(({ nodeId }) => nodeId)),
    [activeTimers],
  );
  const focusedNode = focusedNodeId
    ? graph.nodes.find(({ id }) => id === focusedNodeId) ?? null
    : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateDimensions = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setDimensions({
          width: Math.round(width),
          height: Math.round(height),
        });
      }
    };
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    simulationRef.current?.stop();
    simulationRef.current = null;

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const layoutNodes: LayoutNode[] = graph.nodes.map((node, index) => {
      const orbit = 28 * Math.sqrt(index);
      return {
        id: node.id,
        node,
        radius: graph.radiusByNodeId.get(node.id) ?? 24,
        x: dimensions.width / 2 + Math.cos(index * goldenAngle) * orbit,
        y: dimensions.height / 2 + Math.sin(index * goldenAngle) * orbit,
      };
    });
    const layoutLinks: LayoutLink[] = graph.links.map(({ sourceId, targetId }) => ({
      source: sourceId,
      target: targetId,
    }));
    layoutNodesRef.current = layoutNodes;

    if (layoutNodes.length === 0) {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        setRenderNodes([]);
      });
      return () => {
        if (animationFrameRef.current !== null) {
          window.cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const maximumRadius = layoutNodes.reduce(
        (maximum, layoutNode) => Math.max(maximum, layoutNode.radius),
        24,
      );
      layoutNodes.forEach((layoutNode, index) => {
        const position = staticConstellationPosition(
          index,
          dimensions.width,
          dimensions.height,
          maximumRadius,
        );
        layoutNode.x = position.x;
        layoutNode.y = position.y;
      });
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        setRenderNodes(layoutNodes.map((layoutNode) => ({ ...layoutNode })));
      });
      return () => {
        if (animationFrameRef.current !== null) {
          window.cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }

    const publishLayout = () => {
      if (animationFrameRef.current !== null) {
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        setRenderNodes(layoutNodes.map((layoutNode) => ({ ...layoutNode })));
      });
    };
    const simulation = forceSimulation<LayoutNode>(layoutNodes)
      .force(
        "link",
        forceLink<LayoutNode, LayoutLink>(layoutLinks)
          .id(({ id }) => id)
          .distance((link) => {
            const source = resolvedLinkNode(link.source);
            const target = resolvedLinkNode(link.target);
            return (source?.radius ?? 24) + (target?.radius ?? 24) + 48;
          })
          .strength(0.28),
      )
      .force("charge", forceManyBody<LayoutNode>().strength(-320))
      .force("collide", forceCollide<LayoutNode>().radius(({ radius }) => radius + 12).iterations(2))
      .force("center", forceCenter(dimensions.width / 2, dimensions.height / 2).strength(0.08))
      .force("x", forceX<LayoutNode>(dimensions.width / 2).strength(0.025))
      .force("y", forceY<LayoutNode>(dimensions.height / 2).strength(0.025))
      .alphaDecay(0.035)
      .velocityDecay(0.28)
      .on("tick", publishLayout)
      .on("end", publishLayout);
    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [dimensions.height, dimensions.width, graph, resetVersion]);

  const nodeById = useMemo(
    () => new Map(renderNodes.map((layoutNode) => [layoutNode.id, layoutNode])),
    [renderNodes],
  );

  function setScale(nextScale: number) {
    const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    setTransform((current) => {
      const centerX = dimensions.width / 2;
      const centerY = dimensions.height / 2;
      const worldCenterX = (centerX - current.x) / current.scale;
      const worldCenterY = (centerY - current.y) / current.scale;
      return {
        x: centerX - worldCenterX * scale,
        y: centerY - worldCenterY * scale,
        scale,
      };
    });
  }

  function resetLayout() {
    dragStateRef.current = null;
    setTransform({ x: 0, y: 0, scale: 1 });
    setResetVersion((current) => current + 1);
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    setScale(transform.scale * factor);
  }

  function beginCanvasDrag(event: PointerEvent<SVGSVGElement>) {
    dragStateRef.current = {
      kind: "canvas",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: transform.x,
      startY: transform.y,
    };
    capturePointer(event.currentTarget, event.pointerId);
  }

  function beginNodeDrag(event: PointerEvent<SVGGElement>, node: LayoutNode) {
    event.stopPropagation();
    dragStateRef.current = { kind: "node", nodeId: node.id, pointerId: event.pointerId };
    capturePointer(event.currentTarget, event.pointerId);
    node.fx = node.x;
    node.fy = node.y;
    simulationRef.current?.alphaTarget(0.22).restart();
  }

  function movePointer(event: PointerEvent<SVGSVGElement | SVGGElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (dragState.kind === "canvas") {
      setTransform((current) => ({
        ...current,
        x: dragState.startX + event.clientX - dragState.startClientX,
        y: dragState.startY + event.clientY - dragState.startClientY,
      }));
      return;
    }

    event.stopPropagation();
    const layoutNode = layoutNodesRef.current.find(({ id }) => id === dragState.nodeId);
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!layoutNode || !bounds) {
      return;
    }
    layoutNode.fx = (event.clientX - bounds.left - transform.x) / transform.scale;
    layoutNode.fy = (event.clientY - bounds.top - transform.y) / transform.scale;
    if (!simulationRef.current) {
      layoutNode.x = layoutNode.fx;
      layoutNode.y = layoutNode.fy;
      setRenderNodes(
        layoutNodesRef.current.map((candidate) => ({ ...candidate })),
      );
    }
  }

  function endPointer(event: PointerEvent<SVGSVGElement | SVGGElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (dragState.kind === "node") {
      const layoutNode = layoutNodesRef.current.find(({ id }) => id === dragState.nodeId);
      if (layoutNode) {
        layoutNode.fx = null;
        layoutNode.fy = null;
      }
      simulationRef.current?.alphaTarget(0);
    }
    dragStateRef.current = null;
  }

  function chooseNode(node: DashboardNode) {
    setFocusedNodeId(node.id);
  }

  function handleNodeKeyDown(event: KeyboardEvent<SVGGElement>, node: DashboardNode) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    chooseNode(node);
    window.requestAnimationFrame(() => openNodeButtonRef.current?.focus());
  }

  return (
    <section className="constellation" aria-labelledby="constellation-heading">
      <header className="constellation__header">
        <div>
          <p className="eyebrow">Read-only view</p>
          <h1 id="constellation-heading">Node Constellation</h1>
          <p>Follow the branches, then give a bubble a nudge.</p>
        </div>
        <div className="constellation__legend" aria-label="Constellation legend">
          <span><i className="constellation__legend-root" />Root</span>
          {showCompleted ? <span><i className="constellation__legend-completed" />Completed</span> : null}
          <span><i className="constellation__legend-size" />Size is rolled-up time</span>
        </div>
      </header>

      <div className="constellation__stage" ref={containerRef}>
        {graph.nodes.length === 0 ? (
          <div className="constellation__empty">
            <p>{nodes.length === 0 ? "Create a node to start your constellation." : "No active nodes to map."}</p>
            {nodes.length === 0 ? (
              <button className="text-action" type="button" onClick={onCreateRoot}>
                Create your first root node
              </button>
            ) : (
              <button className="text-action" type="button" onClick={onShowCompleted}>
                Show completed nodes
              </button>
            )}
          </div>
        ) : (
          <>
            <svg
              className="constellation__canvas"
              viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
              aria-label={`${graph.nodes.length} node constellation`}
              onPointerDown={beginCanvasDrag}
              onPointerMove={movePointer}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onWheel={handleWheel}
            >
              <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
                <g className="constellation__links" aria-hidden="true">
                  {graph.links.map((link) => {
                    const source = nodeById.get(link.sourceId);
                    const target = nodeById.get(link.targetId);
                    if (!source || !target) {
                      return null;
                    }
                    return (
                      <line
                        key={`${link.sourceId}:${link.targetId}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                      />
                    );
                  })}
                </g>
                <g className="constellation__nodes">
                  {graph.nodes.map((node) => {
                    const layoutNode = nodeById.get(node.id);
                    if (!layoutNode) {
                      return null;
                    }
                    const duration = constellationDurationSeconds(node, showCompleted);
                    const running = activeNodeIds.has(node.id);
                    const root = !node.parentId || !nodeById.has(node.parentId);
                    const classes = [
                      "constellation-node",
                      root ? "constellation-node--root" : "",
                      running ? "constellation-node--running" : "",
                      node.completedAt ? "constellation-node--completed" : "",
                      focusedNodeId === node.id ? "constellation-node--focused" : "",
                    ].filter(Boolean).join(" ");
                    const state = [
                      `${formatHistoricalDuration(duration)} rolled up`,
                      `${formatHistoricalDuration(node.directDurationSeconds)} direct`,
                      running ? "timer running" : null,
                      node.completedAt ? "completed" : "active",
                    ].filter(Boolean).join(", ");

                    return (
                      <g
                        key={node.id}
                        className={classes}
                        role="button"
                        tabIndex={0}
                        aria-label={`${breadcrumbForNode(node)}: ${state}`}
                        aria-pressed={focusedNodeId === node.id}
                        transform={`translate(${layoutNode.x ?? 0} ${layoutNode.y ?? 0})`}
                        onClick={() => chooseNode(node)}
                        onFocus={() => setFocusedNodeId(node.id)}
                        onKeyDown={(event) => handleNodeKeyDown(event, node)}
                        onPointerDown={(event) => beginNodeDrag(event, layoutNode)}
                        onPointerMove={movePointer}
                        onPointerUp={endPointer}
                        onPointerCancel={endPointer}
                      >
                        {running ? (
                          <circle className="constellation-node__orbit" r={layoutNode.radius + 9} />
                        ) : null}
                        <circle className="constellation-node__bubble" r={layoutNode.radius} />
                        <text className="constellation-node__title" textAnchor="middle" y="-2">
                          {labelForNode(node)}
                        </text>
                        <text className="constellation-node__time" textAnchor="middle" y="15">
                          {formatHistoricalDuration(duration)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>

            <div className="constellation__controls" aria-label="Constellation view controls">
              <button
                className="icon-button"
                type="button"
                aria-label="Zoom out"
                data-tooltip="Zoom out"
                disabled={transform.scale <= MIN_SCALE}
                onClick={() => setScale(transform.scale / 1.2)}
              >
                <MinusIcon />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Reset constellation"
                data-tooltip="Reset constellation"
                onClick={resetLayout}
              >
                <ResetIcon />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Zoom in"
                data-tooltip="Zoom in"
                disabled={transform.scale >= MAX_SCALE}
                onClick={() => setScale(transform.scale * 1.2)}
              >
                <PlusIcon />
              </button>
            </div>

            {focusedNode ? (
              <aside className="constellation-card" aria-label={`${focusedNode.title} constellation details`}>
                <p className="constellation-card__breadcrumb">{breadcrumbForNode(focusedNode)}</p>
                <div className="constellation-card__title">
                  <h2>{focusedNode.title}</h2>
                  <span className={focusedNode.completedAt ? "status-pill status-pill--completed" : "status-pill"}>
                    {focusedNode.completedAt ? "Completed" : "Active"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Rolled up</dt>
                    <dd>{formatHistoricalDuration(constellationDurationSeconds(focusedNode, showCompleted))}</dd>
                  </div>
                  <div>
                    <dt>Direct</dt>
                    <dd>{formatHistoricalDuration(focusedNode.directDurationSeconds)}</dd>
                  </div>
                </dl>
                <button
                  ref={openNodeButtonRef}
                  className="button button--primary button--small"
                  type="button"
                  onClick={() => onOpenNode(focusedNode.id)}
                >
                  Open in tree
                </button>
              </aside>
            ) : (
              <p className="constellation__hint">Choose a node to inspect it.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
