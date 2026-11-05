/**
 * Android store-capture finding, 2026-11-05 (native build 37).
 *
 * Chat video bubbles rendered as a solid black tile. The bubble did
 * `<RNImage source={{ uri: thumbnailUrl || mediaUrl }} />`, and RNImage
 * cannot decode an mp4 -- so every legacy row (no `thumbnail_url`) fed
 * it a video URL, the decode failed silently, and the view's black
 * background was all that remained.
 *
 * `ChatVideoPoster` extracts a frame for those rows and shows a labelled
 * placeholder when even that fails. These tests pin the three outcomes
 * and the bound on repeat work.
 */
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.setTimeout(20_000);

jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

import * as VideoThumbnails from 'expo-video-thumbnails';
import ChatVideoPoster, { __resetPosterCache } from '@/components/ChatVideoPoster';

const getThumbnailAsync = VideoThumbnails.getThumbnailAsync as jest.Mock;

const MP4 = 'https://cdn.example.com/chat/legacy-clip.mp4';
const POSTER = 'file:///tmp/extracted-frame.jpg';
const SUPPLIED = 'https://cdn.example.com/chat/new-clip-thumb.jpg';

function flatten(style: any): Record<string, any> {
  return StyleSheet.flatten(style) ?? {};
}

beforeEach(() => {
  __resetPosterCache();
  getThumbnailAsync.mockReset();
});

describe('a row that already has a poster', () => {
  it('uses the supplied thumbnail and does not extract', async () => {
    const utils = render(
      <ChatVideoPoster mediaUrl={MP4} thumbnailUrl={SUPPLIED} testID="poster" />,
    );

    const img = utils.getByTestId('poster-image');
    expect(img.props.source).toEqual({ uri: SUPPLIED });
    expect(getThumbnailAsync).not.toHaveBeenCalled();
    expect(utils.queryByTestId('poster-placeholder')).toBeNull();
  });

  it('never hands the mp4 to the image, which is what produced the black tile', async () => {
    getThumbnailAsync.mockResolvedValue({ uri: POSTER });
    const utils = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);

    await waitFor(() => expect(utils.queryByTestId('poster-image')).toBeTruthy());
    expect(utils.getByTestId('poster-image').props.source).not.toEqual({ uri: MP4 });
  });
});

describe('a legacy row with no poster', () => {
  it('extracts a frame and renders it', async () => {
    getThumbnailAsync.mockResolvedValue({ uri: POSTER });

    const utils = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);

    await waitFor(() => expect(utils.queryByTestId('poster-image')).toBeTruthy());
    expect(utils.getByTestId('poster-image').props.source).toEqual({ uri: POSTER });
    expect(getThumbnailAsync).toHaveBeenCalledWith(MP4, expect.objectContaining({ time: 0 }));
  });

  it('falls back to a clear, non-black placeholder when extraction fails', async () => {
    getThumbnailAsync.mockRejectedValue(new Error('cannot read media'));

    const utils = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);

    await waitFor(() => expect(utils.queryByTestId('poster-placeholder')).toBeTruthy());
    expect(utils.queryByTestId('poster-image')).toBeNull();
    // The whole point of the placeholder: it must not read as the bug.
    const bg = flatten(utils.getByTestId('poster-placeholder').props.style).backgroundColor;
    expect(bg).toBeTruthy();
    expect(['#000', '#000000', 'black']).not.toContain(String(bg).toLowerCase());
    expect(utils.queryByText('Video')).toBeTruthy();
  });

  it('extracts once per media url, not once per render or mount', async () => {
    getThumbnailAsync.mockResolvedValue({ uri: POSTER });

    const first = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);
    await waitFor(() => expect(first.queryByTestId('poster-image')).toBeTruthy());

    // Re-render, then unmount and mount afresh -- scrolling a FlatList
    // does both, and a per-row extraction on every pass would be the
    // kind of bounded-work failure that shows up as jank.
    first.rerender(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);
    first.unmount();
    const second = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);
    await waitFor(() => expect(second.queryByTestId('poster-image')).toBeTruthy());

    expect(getThumbnailAsync).toHaveBeenCalledTimes(1);
  });

  it('remembers a failure too, rather than retrying forever', async () => {
    getThumbnailAsync.mockRejectedValue(new Error('gone'));

    const first = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);
    await waitFor(() => expect(first.queryByTestId('poster-placeholder')).toBeTruthy());
    first.unmount();

    const second = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="poster" />);
    await waitFor(() => expect(second.queryByTestId('poster-placeholder')).toBeTruthy());

    expect(getThumbnailAsync).toHaveBeenCalledTimes(1);
  });

  it('shares one extraction between two bubbles mounted at the same time', async () => {
    let resolve: (v: any) => void = () => {};
    getThumbnailAsync.mockReturnValue(new Promise((res) => { resolve = res; }));

    const a = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="a" />);
    const b = render(<ChatVideoPoster mediaUrl={MP4} thumbnailUrl={null} testID="b" />);

    await act(async () => {
      resolve({ uri: POSTER });
      await Promise.resolve();
    });

    await waitFor(() => expect(a.queryByTestId('a-image')).toBeTruthy());
    await waitFor(() => expect(b.queryByTestId('b-image')).toBeTruthy());
    expect(getThumbnailAsync).toHaveBeenCalledTimes(1);
  });
});

describe('a broken supplied thumbnail', () => {
  it('falls through to extraction when the stored thumbnail will not decode', async () => {
    getThumbnailAsync.mockResolvedValue({ uri: POSTER });

    const utils = render(
      <ChatVideoPoster mediaUrl={MP4} thumbnailUrl={SUPPLIED} testID="poster" />,
    );
    expect(utils.getByTestId('poster-image').props.source).toEqual({ uri: SUPPLIED });

    // A 404 or a non-image body: RN reports it through onError.
    await act(async () => {
      utils.getByTestId('poster-image').props.onError();
    });

    await waitFor(() =>
      expect(utils.getByTestId('poster-image').props.source).toEqual({ uri: POSTER }),
    );
    expect(getThumbnailAsync).toHaveBeenCalledTimes(1);
  });

  it('settles on the placeholder if the fallback extraction also fails', async () => {
    getThumbnailAsync.mockRejectedValue(new Error('nope'));

    const utils = render(
      <ChatVideoPoster mediaUrl={MP4} thumbnailUrl={SUPPLIED} testID="poster" />,
    );
    await act(async () => {
      utils.getByTestId('poster-image').props.onError();
    });

    await waitFor(() => expect(utils.queryByTestId('poster-placeholder')).toBeTruthy());
    expect(utils.queryByTestId('poster-image')).toBeNull();
  });
});
