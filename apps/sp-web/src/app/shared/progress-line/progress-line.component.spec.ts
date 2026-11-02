import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProgressLineComponent } from './progress-line.component';

describe('ProgressLineComponent', () => {
  let fixture: ComponentFixture<ProgressLineComponent>;
  const fill = () => fixture.nativeElement.querySelector('.progress-fill') as HTMLElement | null;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = TestBed.createComponent(ProgressLineComponent);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('shows nothing without progress', () => {
    fixture.componentRef.setInput('percent', null);
    fixture.detectChanges();
    expect(fill()).toBeNull();
  });

  it('slides back to nothing when cleared, then goes', () => {
    fixture.componentRef.setInput('percent', 60);
    fixture.detectChanges();
    expect(fill()?.style.width).toBe('60%');

    fixture.componentRef.setInput('percent', null);
    fixture.detectChanges();
    expect(fill()?.style.width).toBe('0%');

    vi.advanceTimersByTime(ProgressLineComponent.CLEAR_MS);
    fixture.detectChanges();
    expect(fill()).toBeNull();
  });

  it('stays if progress comes back while it slides', () => {
    fixture.componentRef.setInput('percent', 60);
    fixture.detectChanges();
    fixture.componentRef.setInput('percent', null);
    fixture.detectChanges();
    fixture.componentRef.setInput('percent', 10);
    fixture.detectChanges();

    vi.advanceTimersByTime(ProgressLineComponent.CLEAR_MS);
    fixture.detectChanges();
    expect(fill()?.style.width).toBe('10%');
  });
});
