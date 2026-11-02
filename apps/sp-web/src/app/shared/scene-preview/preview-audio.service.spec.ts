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
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('plays with sound, one at a time', async () => {
    const first = preview();
    const second = preview();
    await service.play(first);
    expect(first.muted).toBe(false);

    await service.play(second);
    expect(second.muted).toBe(false);
    expect(first.muted).toBe(true);
  });

  it('muting one mutes the rest, until a new page', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/a');
    const first = preview();
    await service.play(first);

    service.toggle(first);
    expect(first.muted).toBe(true);

    const second = preview();
    await service.play(second);
    expect(second.muted).toBe(true);

    await router.navigateByUrl('/a?x=1');
    const third = preview();
    await service.play(third);
    expect(third.muted).toBe(true);

    await router.navigateByUrl('/b');
    const fourth = preview();
    await service.play(fourth);
    expect(fourth.muted).toBe(false);
  });

  it('plays muted when sound is refused, and tapping turns it on', async () => {
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

  it('stays silent while a scene plays, and leaves when one starts', async () => {
    const first = preview();
    await service.play(first);

    const scene = document.createElement('video');
    document.body.appendChild(scene);
    scene.dispatchEvent(new Event('play'));
    expect(first.muted).toBe(true);
    scene.remove();
  });
});
