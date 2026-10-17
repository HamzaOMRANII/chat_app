package com.omranisystems.hchat;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Opens the folder where H_CHAT saves files (Documents/H_CHAT) in the phone's Files app. */
@CapacitorPlugin(name = "Folders")
public class FoldersPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path", "Documents/H_CHAT");
        Uri folder = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:" + path);
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(folder, DocumentsContract.Document.MIME_TYPE_DIR);
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(view);
            call.resolve();
            return;
        } catch (ActivityNotFoundException ignored) {
            // Some phones' Files apps don't open a folder link: open the Files app itself
        }
        try {
            Intent files = new Intent(Intent.ACTION_VIEW);
            files.setDataAndType(DocumentsContract.buildRootUri("com.android.externalstorage.documents", "primary"), DocumentsContract.Root.MIME_TYPE_ITEM);
            files.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(files);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No Files app found");
        }
    }
}
