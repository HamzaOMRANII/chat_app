package com.omranisystems.hchat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureScreenPlugin.class);
        registerPlugin(FoldersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
