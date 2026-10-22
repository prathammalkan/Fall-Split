import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteQrScanner } from './InviteQrScanner';

const camera = vi.hoisted(() => ({ getUserMedia: vi.fn(), detect: vi.fn() }));

vi.mock('../../lib/inviteUrl', () => ({
  parseInviteUrl: (value: string) => {
    const match = /^https:\/\/split\.example\/invite\/([a-zA-Z0-9_-]{16,128})$/.exec(value);
    if (!match) throw new Error('This QR code is not a valid Fall Split invitation link.');
    return match[1];
  },
}));

class MockBarcodeDetector {
  constructor(_options: { formats: string[] }) {}
  detect = camera.detect;
}

function makeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

describe('InviteQrScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('BarcodeDetector', MockBarcodeDetector);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: camera.getUserMedia },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  });

  it('navigates once when the same valid QR is detected repeatedly and stops the camera on cleanup', async () => {
    const { stream, track } = makeStream();
    const token = 'b'.repeat(64);
    camera.getUserMedia.mockResolvedValue(stream);
    camera.detect.mockResolvedValue([{ rawValue: `https://split.example/invite/${token}` }]);
    const onScan = vi.fn();
    const { unmount } = render(<InviteQrScanner onScan={onScan} onClose={vi.fn()} />);
    const video = screen.getByLabelText('Camera view for QR scanning');
    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });

    await waitFor(() => expect(onScan).toHaveBeenCalledWith(token));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(onScan).toHaveBeenCalledTimes(1);

    unmount();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('does not navigate for a non-invitation QR payload', async () => {
    const { stream } = makeStream();
    camera.getUserMedia.mockResolvedValue(stream);
    camera.detect.mockResolvedValue([{ rawValue: 'https://evil.example/login' }]);
    const onScan = vi.fn();
    render(<InviteQrScanner onScan={onScan} onClose={vi.fn()} />);
    Object.defineProperty(screen.getByLabelText('Camera view for QR scanning'), 'readyState', {
      configurable: true,
      value: 2,
    });

    expect(
      await screen.findByText('This QR code is not a valid Fall Split invitation link.')
    ).toBeTruthy();
    expect(onScan).not.toHaveBeenCalled();
  });

  it('keeps the camera active after rejecting a non-invitation QR and accepts the next valid code', async () => {
    const { stream } = makeStream();
    const token = 'c'.repeat(64);
    camera.getUserMedia.mockResolvedValue(stream);
    camera.detect
      .mockResolvedValueOnce([{ rawValue: 'https://evil.example/login' }])
      .mockResolvedValue([{ rawValue: `https://split.example/invite/${token}` }]);
    const onScan = vi.fn();
    render(<InviteQrScanner onScan={onScan} onClose={vi.fn()} />);
    Object.defineProperty(screen.getByLabelText('Camera view for QR scanning'), 'readyState', {
      configurable: true,
      value: 2,
    });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Camera view for QR scanning')).toBeTruthy();
    await waitFor(() => expect(onScan).toHaveBeenCalledWith(token));
  });

  it('stops a camera stream that resolves after the scanner has already unmounted', async () => {
    let resolveCamera: ((value: MediaStream) => void) | undefined;
    camera.getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        resolveCamera = resolve;
      })
    );
    const { unmount } = render(<InviteQrScanner onScan={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledOnce());
    unmount();

    const { stream, track } = makeStream();
    resolveCamera?.(stream);
    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
  });

  it('stops on a persistent detector error and retries the camera without weakening URL checks', async () => {
    const first = makeStream();
    const retry = makeStream();
    const token = 'd'.repeat(64);
    camera.getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(retry.stream);
    camera.detect
      .mockRejectedValueOnce(new Error('decoder failed'))
      .mockResolvedValue([{ rawValue: `https://split.example/invite/${token}` }]);
    const onScan = vi.fn();
    const { unmount } = render(<InviteQrScanner onScan={onScan} onClose={vi.fn()} />);
    Object.defineProperty(screen.getByLabelText('Camera view for QR scanning'), 'readyState', {
      configurable: true,
      value: 2,
    });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'QR scanning stopped unexpectedly'
    );
    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(onScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(camera.getUserMedia).toHaveBeenCalledTimes(2));
    Object.defineProperty(screen.getByLabelText('Camera view for QR scanning'), 'readyState', {
      configurable: true,
      value: 2,
    });
    await waitFor(() => expect(onScan).toHaveBeenCalledWith(token));
    unmount();
    expect(retry.track.stop).toHaveBeenCalledOnce();
  });
});
