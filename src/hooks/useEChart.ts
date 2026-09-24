"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

/**
 * Creates an ECharts instance in `containerRef`, keeps it sized, and applies
 * `initialOption` once. Later updates merge over it, so state set here (zoom,
 * default legend selection) survives the live data refreshes.
 */
export function useEChart(
  containerRef: React.RefObject<HTMLDivElement | null>,
  initialOption?: echarts.EChartsOption
) {
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const initialRef = useRef(initialOption);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: getComputedStyle(container).fontFamily },
      ...initialRef.current,
    });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [containerRef]);

  return chartRef;
}
