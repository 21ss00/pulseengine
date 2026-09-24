"use client";

import type { WorldData } from "@/hooks/useWorldData";
import type { FeedStatus } from "@/config/feeds";
import type { SourceStatus } from "@/types/world";
import { CrossAssetWindow, FxWindow, MetalsWindow } from "@/components/world/MarketsWindows";
import { NewsWindow, PoliticsWindow, SocialWindow } from "@/components/world/PoliticsNewsWindows";
import { PlanetWindow, WeatherWindow } from "@/components/world/PlanetWindows";
import { MacroWindow } from "@/components/world/MacroWindow";
import { PulseWindow, SourcesWindow } from "@/components/world/PulseWindow";

export default function WorldView({
  data,
  sources,
  feeds,
}: {
  data: WorldData;
  sources: SourceStatus[];
  feeds: FeedStatus[];
}) {
  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-12" data-testid="world-view">
      <div className="xl:col-span-12">
        <PulseWindow data={data} />
      </div>
      <div className="xl:col-span-7">
        <FxWindow data={data} />
      </div>
      <div className="xl:col-span-5">
        <MetalsWindow data={data} />
      </div>
      <div className="xl:col-span-6">
        <PoliticsWindow data={data} />
      </div>
      <div className="xl:col-span-6">
        <NewsWindow data={data} />
      </div>
      <div className="xl:col-span-12">
        <PlanetWindow data={data} />
      </div>
      <div className="xl:col-span-7">
        <MacroWindow data={data} />
      </div>
      <div className="xl:col-span-5">
        <SocialWindow data={data} />
      </div>
      <div className="xl:col-span-5">
        <WeatherWindow data={data} />
      </div>
      <div className="xl:col-span-7">
        <CrossAssetWindow data={data} />
      </div>
      <div className="xl:col-span-12">
        <SourcesWindow sources={sources} feeds={feeds} />
      </div>
    </div>
  );
}
