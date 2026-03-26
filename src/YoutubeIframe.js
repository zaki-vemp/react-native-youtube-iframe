import React, {
  useRef,
  useMemo,
  useState,
  useEffect,
  forwardRef,
  useCallback,
  useImperativeHandle,
} from 'react';
import {Linking, Platform, StyleSheet, View} from 'react-native';
import {EventEmitter} from 'events';
import {WebView} from './WebView';
import {
  PLAYER_ERROR,
  PLAYER_STATES,
  DEFAULT_BASE_URL,
  CUSTOM_USER_AGENT,
} from './constants';
import {MAIN_SCRIPT, PLAYER_FUNCTIONS} from './PlayerScripts';
import {deepComparePlayList} from './utils';

const YoutubeIframe = (props, ref) => {
  const {
    height,
    width,
    videoId,
    playList,
    play = false,
    mute = false,
    volume = 100,
    viewContainerStyle,
    webViewStyle,
    webViewProps,
    useLocalHTML,
    baseUrlOverride,
    playbackRate = 1,
    contentScale = 1.0,
    onError = _err => {},
    onReady = _event => {},
    playListStartIndex = 0,
    initialPlayerParams,
    allowWebViewZoom = false,
    forceAndroidAutoplay = false,
    onChangeState = _event => {},
    onFullScreenChange = _status => {},
    onPlaybackQualityChange = _quality => {},
    onPlaybackRateChange = _playbackRate => {},
    onWebViewLog,
    onPlayerAction,
  } = props;

  const [playerReady, setPlayerReady] = useState(false);
  const playerReadyRef = useRef(false);
  const initialCommandsSentRef = useRef(false);
  const lastVideoIdRef = useRef(videoId);
  const lastPlayListRef = useRef(playList);
  const initialPlayerParamsRef = useRef(initialPlayerParams || {});

  const webViewRef = useRef(null);
  const eventEmitter = useRef(new EventEmitter());

  // Store callback props in refs so sendPostMessage/onWebMessage don't get
  // new identities when the caller passes inline functions.
  const onWebViewLogRef = useRef(onWebViewLog);
  const onPlayerActionRef = useRef(onPlayerAction);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onChangeStateRef = useRef(onChangeState);
  const onFullScreenChangeRef = useRef(onFullScreenChange);
  const onPlaybackRateChangeRef = useRef(onPlaybackRateChange);
  const onPlaybackQualityChangeRef = useRef(onPlaybackQualityChange);

  useEffect(() => {
    onWebViewLogRef.current = onWebViewLog;
    onPlayerActionRef.current = onPlayerAction;
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onChangeStateRef.current = onChangeState;
    onFullScreenChangeRef.current = onFullScreenChange;
    onPlaybackRateChangeRef.current = onPlaybackRateChange;
    onPlaybackQualityChangeRef.current = onPlaybackQualityChange;
  });

  const sendPostMessage = useCallback(
    (eventName, meta) => {
      if (!playerReadyRef.current) {
        return;
      }

      const message = JSON.stringify({eventName, meta});
      if (onWebViewLogRef.current) {
        onWebViewLogRef.current(`[rn-youtube-iframe] Sending message: ${message}`);
      }
      webViewRef.current.postMessage(message);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      getVideoUrl: () => {
        webViewRef.current.injectJavaScript(PLAYER_FUNCTIONS.getVideoUrlScript);
        return new Promise(resolve => {
          eventEmitter.current.once('getVideoUrl', resolve);
        });
      },
      getDuration: () => {
        webViewRef.current.injectJavaScript(PLAYER_FUNCTIONS.durationScript);
        return new Promise(resolve => {
          eventEmitter.current.once('getDuration', resolve);
        });
      },
      getCurrentTime: () => {
        webViewRef.current.injectJavaScript(PLAYER_FUNCTIONS.currentTimeScript);
        return new Promise(resolve => {
          eventEmitter.current.once('getCurrentTime', resolve);
        });
      },
      isMuted: () => {
        webViewRef.current.injectJavaScript(PLAYER_FUNCTIONS.isMutedScript);
        return new Promise(resolve => {
          eventEmitter.current.once('isMuted', resolve);
        });
      },
      getVolume: () => {
        webViewRef.current.injectJavaScript(PLAYER_FUNCTIONS.getVolumeScript);
        return new Promise(resolve => {
          eventEmitter.current.once('getVolume', resolve);
        });
      },
      getPlaybackRate: () => {
        webViewRef.current.injectJavaScript(
          PLAYER_FUNCTIONS.getPlaybackRateScript,
        );
        return new Promise(resolve => {
          eventEmitter.current.once('getPlaybackRate', resolve);
        });
      },
      getAvailablePlaybackRates: () => {
        webViewRef.current.injectJavaScript(
          PLAYER_FUNCTIONS.getAvailablePlaybackRatesScript,
        );
        return new Promise(resolve => {
          eventEmitter.current.once('getAvailablePlaybackRates', resolve);
        });
      },
      seekTo: (seconds, allowSeekAhead) => {
        webViewRef.current.injectJavaScript(
          PLAYER_FUNCTIONS.seekToScript(seconds, allowSeekAhead),
        );
      },
    }),
    [],
  );

  // Send initial commands when player becomes ready (only once)
  useEffect(() => {
    if (!playerReady || initialCommandsSentRef.current) {
      return;
    }

    initialCommandsSentRef.current = true;

    // Send initial state commands
    if (play) {
      sendPostMessage('playVideo', {});
    }
    if (!mute) {
      sendPostMessage('unMuteVideo', {});
    }
    sendPostMessage('setVolume', {volume});
    sendPostMessage('setPlaybackRate', {playbackRate});
  }, [playerReady]); // Only run once when playerReady changes

  useEffect(() => {
    if (play) {
      sendPostMessage('playVideo', {});
    } else {
      sendPostMessage('pauseVideo', {});
    }
  }, [play, sendPostMessage]);

  useEffect(() => {
    if (mute) {
      sendPostMessage('muteVideo', {});
    } else {
      sendPostMessage('unMuteVideo', {});
    }
  }, [mute, sendPostMessage]);

  useEffect(() => {
    sendPostMessage('setVolume', {volume});
  }, [sendPostMessage, volume]);

  useEffect(() => {
    sendPostMessage('setPlaybackRate', {playbackRate});
  }, [sendPostMessage, playbackRate]);

  useEffect(() => {
    if (!playerReady || lastVideoIdRef.current === videoId) {
      // no instance of player is ready
      // or videoId has not changed
      return;
    }

    lastVideoIdRef.current = videoId;

    webViewRef.current.injectJavaScript(
      PLAYER_FUNCTIONS.loadVideoById(videoId, play),
    );
  }, [videoId, play, playerReady]);

  useEffect(() => {
    if (!playerReady) {
      // no instance of player is ready
      return;
    }

    // Also, right now, we are helping users by doing "deep" comparisons of playList prop,
    // but in the next major we should leave the responsibility to user (either via useMemo or moving the array outside)
    if (!playList || deepComparePlayList(lastPlayListRef.current, playList)) {
      return;
    }

    lastPlayListRef.current = playList;

    webViewRef.current.injectJavaScript(
      PLAYER_FUNCTIONS.loadPlaylist(playList, playListStartIndex, play),
    );
  }, [playList, play, playListStartIndex, playerReady]);

  const onWebMessage = useCallback(
    event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (onWebViewLogRef.current && message.eventType !== 'webViewLog') {
          onWebViewLogRef.current(`[rn-youtube-iframe] Received message: ${JSON.stringify(message)}`);
        }

        if (onPlayerActionRef.current) {
          onPlayerActionRef.current({
            type: message.eventType,
            data: message.data,
          });
        }

        switch (message.eventType) {
          case 'fullScreenChange':
            onFullScreenChangeRef.current(message.data);
            break;
          case 'playerStateChange':
            onChangeStateRef.current(PLAYER_STATES[message.data]);
            break;
          case 'playerReady':
            onReadyRef.current();
            if (!playerReadyRef.current) {
              playerReadyRef.current = true;
              setPlayerReady(true);
            }
            break;
          case 'playerQualityChange':
            onPlaybackQualityChangeRef.current(message.data);
            break;
          case 'playerError':
            onErrorRef.current(PLAYER_ERROR[message.data]);
            break;
          case 'playbackRateChange':
            onPlaybackRateChangeRef.current(message.data);
            break;
          case 'webViewLog':
            if (onWebViewLogRef.current) {
              const logPrefix = message.data?.level ? `[WebView:${message.data.level}] ` : '[WebView] ';
              onWebViewLogRef.current(logPrefix + (message.data?.message || message.data));
            }
            break;
          default:
            eventEmitter.current.emit(message.eventType, message.data);
            break;
        }
      } catch (error) {
        console.warn('[rn-youtube-iframe]', error);
      }
    },
    [],
  );

  const onShouldStartLoadWithRequest = useCallback(
    request => {
      try {
        const url = request.mainDocumentURL || request.url;
        if (Platform.OS === 'ios') {
          const iosFirstLoad = url === 'about:blank';
          if (iosFirstLoad) {
            return true;
          }
          const isYouTubeLink = url.startsWith('https://www.youtube.com/');
          if (isYouTubeLink) {
            Linking.openURL(url).catch(error => {
              console.warn('Error opening URL:', error);
            });
            return false;
          }
        }
        return url.startsWith(baseUrlOverride || DEFAULT_BASE_URL);
      } catch (error) {
        // defaults to true in case of error
        // returning false stops the video from loading
        return true;
      }
    },
    [baseUrlOverride],
  );

  const source = useMemo(() => {
    const ytScript = MAIN_SCRIPT(
      lastVideoIdRef.current,
      lastPlayListRef.current,
      initialPlayerParamsRef.current,
      allowWebViewZoom,
      contentScale,
    );

    if (useLocalHTML) {
      const res = {html: ytScript.htmlString};
      if (baseUrlOverride) {
        res.baseUrl = baseUrlOverride;
      }
      return res;
    }

    const base = baseUrlOverride || DEFAULT_BASE_URL;
    const data = ytScript.urlEncodedJSON;

    return {uri: base + '?data=' + data};
  }, [useLocalHTML, contentScale, baseUrlOverride, allowWebViewZoom]);

  return (
    <View style={[{height, width}, viewContainerStyle]}>
      <WebView
        bounces={false}
        originWhitelist={['*']}
        allowsInlineMediaPlayback
        style={[styles.webView, webViewStyle]}
        mediaPlaybackRequiresUserAction={false}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        allowsFullscreenVideo={
          !initialPlayerParamsRef.current.preventFullScreen
        }
        userAgent={
          forceAndroidAutoplay
            ? Platform.select({android: CUSTOM_USER_AGENT, ios: ''})
            : ''
        }
        // props above this are override-able

        // --
        {...webViewProps}
        // --

        // add props that should not be allowed to be overridden below
        source={source}
        ref={webViewRef}
        onMessage={onWebMessage}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  webView: {backgroundColor: 'transparent'},
});

export default forwardRef(YoutubeIframe);
