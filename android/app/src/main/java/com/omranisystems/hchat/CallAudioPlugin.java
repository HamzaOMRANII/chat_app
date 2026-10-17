package com.omranisystems.hchat;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * Where a call's sound plays: the loudspeaker or the earpiece. Without this, Android sends a web view's call
 * audio to the earpiece, quietly. During a call the volume buttons control the call volume.
 */
@CapacitorPlugin(name = "CallAudio")
public class CallAudioPlugin extends Plugin {
    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void start(PluginCall call) {
        boolean speaker = Boolean.TRUE.equals(call.getBoolean("speaker", true));
        AudioManager am = audio();
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        getActivity().runOnUiThread(() -> getActivity().setVolumeControlStream(AudioManager.STREAM_VOICE_CALL));
        route(am, speaker);
        call.resolve(state(am));
    }

    @PluginMethod
    public void setSpeaker(PluginCall call) {
        AudioManager am = audio();
        route(am, Boolean.TRUE.equals(call.getBoolean("on", true)));
        call.resolve(state(am));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AudioManager am = audio();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
        else am.setSpeakerphoneOn(false);
        am.setMode(AudioManager.MODE_NORMAL);
        getActivity().runOnUiThread(() -> getActivity().setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE));
        call.resolve();
    }

    private void route(AudioManager am, boolean speaker) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            int wanted = speaker ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
            // A headset or earbuds, when connected, win over the earpiece
            if (!speaker) {
                for (AudioDeviceInfo d : devices) {
                    int t = d.getType();
                    if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_WIRED_HEADSET || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_BLE_HEADSET) {
                        am.setCommunicationDevice(d);
                        return;
                    }
                }
            }
            for (AudioDeviceInfo d : devices) {
                if (d.getType() == wanted) {
                    am.setCommunicationDevice(d);
                    return;
                }
            }
        } else {
            am.setSpeakerphoneOn(speaker);
        }
    }

    private JSObject state(AudioManager am) {
        JSObject out = new JSObject();
        boolean speaker;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioDeviceInfo d = am.getCommunicationDevice();
            speaker = d != null && d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
        } else {
            speaker = am.isSpeakerphoneOn();
        }
        out.put("speaker", speaker);
        return out;
    }
}
