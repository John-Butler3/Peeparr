import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { PreviewAudioService } from './preview-audio.service';

@Component({ template: '' })
class Blank {}

describe('PreviewAudioService', () => {
  let service: PreviewAudioService;
  let play: ReturnType<typeof vi.spyOn>;
  const preview = () => {
    const video = document.createElement('video');
    video.className = 'hover-preview';
    video.muted = true;
    document.body.appendChild(video);
    return video;
  };

  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'a', component: Blank },
          { path: 'b', component: Blank },
        ]),
      ],
    });
    service = TestBed.inject(PreviewAudioService);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('plays muted until sound is turned on', async () => {
    expect(service.muted()).toBe(true);
    const first = preview();
    await service.play(first);
    expect(first.muted).toBe(true);

    service.toggle(first);
    expect(first.muted).toBe(false);
    expect(service.muted()).toBe(false);
  });

  it('with sound on, plays one at a time', async () => {
    const first = preview();
    const second = preview();
    await service.play(first);
    service.toggle(first);
    expect(first.muted).toBe(false);

    await service.play(second);
    expect(second.muted).toBe(false);
    expect(first.muted).toBe(true);
  });

  it('turning sound on carries to the rest, muting one mutes them, and a new page starts muted', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/a');
    const first = preview();
    await service.play(first);
    service.toggle(first);

    const second = preview();
    await service.play(second);
    expect(second.muted).toBe(false);

    service.toggle(second);
    expect(second.muted).toBe(true);
    const third = preview();
    await service.play(third);
    expect(third.muted).toBe(true);

    service.toggle(third);
    await router.navigateByUrl('/a?x=1');
    const sameDifferentQuery = preview();
    await service.play(sameDifferentQuery);
    expect(sameDifferentQuery.muted).toBe(false);

    await router.navigateByUrl('/b');
    const fourth = preview();
    await service.play(fourth);
    expect(fourth.muted).toBe(true);
    expect(service.muted()).toBe(true);
  });

  it('plays muted when sound is refused, and tapping turns it on', async () => {
    const first = preview();
    await service.play(first);
    service.toggle(first);

    play.mockClear();
    play.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    const video = preview();
    await service.play(video);
    expect(video.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);

    service.toggle(video);
    expect(video.muted).toBe(false);
    expect(service.muted()).toBe(false);
  });

  it('keeps a tapped video for the next preview', async () => {
    const video = preview();
    await service.play(video);
    video.muted = true;
    service.toggle(video);
    service.release(video);

    expect(service.takeVideo()).toBe(video);
    expect(service.takeVideo()).not.toBe(video);
  });

  it('never plays one whose page has been left, and stops those still going', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/a');
    const playingOn = preview();
    await service.play(playingOn);
    service.toggle(playingOn);
    expect(playingOn.muted).toBe(false);

    // Its page kept, out of the document.
    playingOn.remove();
    await router.navigateByUrl('/b');
    expect(playingOn.muted).toBe(true);
    expect(pause).toHaveBeenCalled();

    // One due to start (a hover's timer) after its page went.
    const late = preview();
    late.remove();
    play.mockClear();
    await service.play(late);
    expect(late.muted).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it('stays silent while a scene plays, and leaves when one starts', async () => {
    const first = preview();
    await service.play(first);
    service.toggle(first);
    expect(first.muted).toBe(false);

    const scene = document.createElement('video');
    document.body.appendChild(scene);
    scene.dispatchEvent(new Event('play'));
    expect(first.muted).toBe(true);
    scene.remove();
  });
});
