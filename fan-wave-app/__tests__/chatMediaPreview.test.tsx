import React from 'react';
import { render } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import ChatMediaPreview from '../components/ChatMediaPreview';

jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => ({})),
  VideoView: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'video-preview' }),
}));

beforeEach(() => jest.clearAllMocks());

it('renders query/signed video URLs as video using message metadata', () => {
  const url = 'https://storage.test/clip.mp4?token=fixture#play';
  const view = render(<ChatMediaPreview media={{ url, type: 'video' }} onClose={() => {}} />);
  expect(view.getByTestId('video-preview')).toBeTruthy();
  expect(useVideoPlayer).toHaveBeenLastCalledWith(url, expect.any(Function));
});

it('uses video metadata even when the URL has no file extension', () => {
  const url = 'https://storage.test/download?id=fixture';
  const view = render(<ChatMediaPreview media={{ url, type: 'video' }} onClose={() => {}} />);
  expect(view.getByTestId('video-preview')).toBeTruthy();
  expect(useVideoPlayer).toHaveBeenLastCalledWith(url, expect.any(Function));
});

it('clears the video source on close and does not send images to the player', () => {
  const view = render(<ChatMediaPreview media={{ url: 'https://storage.test/a.mp4', type: 'video' }} onClose={() => {}} />);
  view.rerender(<ChatMediaPreview media={null} onClose={() => {}} />);
  expect(useVideoPlayer).toHaveBeenLastCalledWith(null, expect.any(Function));
  view.rerender(<ChatMediaPreview media={{ url: 'https://storage.test/photo.jpg', type: 'image' }} onClose={() => {}} />);
  expect(view.queryByTestId('video-preview')).toBeNull();
  expect(useVideoPlayer).toHaveBeenLastCalledWith(null, expect.any(Function));
});
