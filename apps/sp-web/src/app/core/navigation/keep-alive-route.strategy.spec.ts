import { ActivatedRouteSnapshot, DetachedRouteHandle } from '@angular/router';
import { KeepAliveRouteStrategy } from './keep-alive-route.strategy';

// A page's route: its config path, and the URL it was opened at.
function route(path: string, url: string): ActivatedRouteSnapshot {
  const page = {
    routeConfig: { path },
    url: url.split('/').map((segment) => ({ path: segment })),
  } as unknown as ActivatedRouteSnapshot;
  const shell = { routeConfig: { path: '' }, url: [] } as unknown as ActivatedRouteSnapshot;
  Object.defineProperty(page, 'pathFromRoot', { value: [shell, page] });
  return page;
}

function handle(): DetachedRouteHandle & { componentRef: { destroy: ReturnType<typeof vi.fn> } } {
  return { componentRef: { destroy: vi.fn() } };
}

describe('KeepAliveRouteStrategy', () => {
  const strategy = () => new KeepAliveRouteStrategy();

  it('keeps browsing and watching pages, not Acquisition or Settings', () => {
    const keep = strategy();
    expect(keep.shouldDetach(route('library/scene/:sceneId', 'library/scene/412'))).toBe(true);
    expect(keep.shouldDetach(route('home', 'home'))).toBe(true);
    expect(keep.shouldDetach(route('acquisition', 'acquisition'))).toBe(false);
    expect(keep.shouldDetach(route('integrations', 'integrations'))).toBe(false);
  });

  it('gives a kept page back when you return to it, per scene', () => {
    const keep = strategy();
    const scene412 = handle();
    keep.store(route('library/scene/:sceneId', 'library/scene/412'), scene412);

    const back = route('library/scene/:sceneId', 'library/scene/412');
    expect(keep.shouldAttach(back)).toBe(true);
    expect(keep.retrieve(back)).toBe(scene412);
    // Another scene is its own page.
    expect(keep.shouldAttach(route('library/scene/:sceneId', 'library/scene/413'))).toBe(false);

    // Taken back: no longer stored.
    keep.store(back, null);
    expect(keep.shouldAttach(back)).toBe(false);
  });

  it('keeps the most recent few, closing older ones properly', () => {
    const keep = strategy();
    const handles = Array.from({ length: KeepAliveRouteStrategy.MAX_PAGES + 1 }, () => handle());
    handles.forEach((stored, i) =>
      keep.store(route('performer/:performerId', `performer/${i}`), stored),
    );

    expect(handles[0].componentRef.destroy).toHaveBeenCalled();
    expect(keep.shouldAttach(route('performer/:performerId', 'performer/0'))).toBe(false);
    expect(handles[1].componentRef.destroy).not.toHaveBeenCalled();
    expect(
      keep.shouldAttach(
        route('performer/:performerId', `performer/${KeepAliveRouteStrategy.MAX_PAGES}`),
      ),
    ).toBe(true);
  });

  it("never lets the miniplayer's scene page go, however many come after it", () => {
    const keep = strategy();
    const scene = handle();
    keep.store(route('library/scene/:sceneId', 'library/scene/412'), scene);
    keep.pin('/library/scene/412?autoplay=1');

    for (let i = 0; i < KeepAliveRouteStrategy.MAX_PAGES + 3; i++) {
      keep.store(route('performer/:performerId', `performer/${i}`), handle());
    }

    expect(scene.componentRef.destroy).not.toHaveBeenCalled();
    expect(keep.shouldAttach(route('library/scene/:sceneId', 'library/scene/412'))).toBe(true);
  });
});
