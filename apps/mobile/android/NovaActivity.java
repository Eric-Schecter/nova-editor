package org.nova.editor.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.libsdl.app.SDLActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Locale;

public final class NovaActivity extends SDLActivity {
    private static final int PICK_MODEL = 124;
    private static final int PANEL = 0xff202226, FIELD = 0xff2a2d32;
    private static final int TEXT = 0xffe1e4e9, MUTED = 0xffb4bcc7;
    private TextView status;
    private LinearLayout drawer;
    private final Button[] tabs = new Button[3];
    private final String[] headings = {"Scene", "Properties", "Assets"};
    private int openTab = -1;
    private String model = "";
    private boolean selected;

    private native void submitImport(String path, String name);
    private native void saveProject();
    private native void openProject();
    private native void selectModel();

    @Override protected String[] getLibraries() {
        return new String[] { "main" };
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(PANEL);
        panel.setPadding(dp(8), 0, dp(8), dp(6));
        LinearLayout row = new LinearLayout(this);
        panel.addView(row);
        addButton(row, "Import GLB", this::chooseModel);
        addButton(row, "Save", this::saveProject);
        addButton(row, "Open", this::openProject);
        status = new TextView(this);
        status.setGravity(Gravity.CENTER);
        status.setTextColor(MUTED);
        status.setText("Import a GLB to start");
        panel.addView(status);
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(-1, -2, Gravity.TOP);

        addContentView(panel, layout);
        panel.setOnApplyWindowInsetsListener((view, insets) -> {
            layout.topMargin = insets.getSystemWindowInsetTop();
            view.setLayoutParams(layout);
            return insets;
        });
        panel.requestApplyInsets();

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        drawer = new LinearLayout(this);
        drawer.setOrientation(LinearLayout.VERTICAL);
        drawer.setPadding(dp(16), dp(14), dp(16), dp(18));
        android.graphics.drawable.GradientDrawable background = new android.graphics.drawable.GradientDrawable();
        background.setColor(PANEL);
        background.setCornerRadius(dp(12));
        drawer.setBackground(background);
        bottom.addView(drawer, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout bar = new LinearLayout(this);
        bar.setBackgroundColor(PANEL);
        bottom.addView(bar);
        for (int index = 0; index < tabs.length; ++index) {
            final int tab = index;
            tabs[index] = addButton(bar, headings[index], () -> {
                openTab = openTab == tab ? -1 : tab;
                refreshDrawer();
            });
        }
        addContentView(bottom, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        bottom.setOnApplyWindowInsetsListener((view, insets) -> {
            bar.setPadding(0, 0, 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        bottom.requestApplyInsets();
        refreshDrawer();
    }

    private int dp(int pixels) {
        return Math.round(pixels * getResources().getDisplayMetrics().density);
    }

    private Button button(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(TEXT);
        button.setBackgroundColor(PANEL);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private Button addButton(LinearLayout row, String label, Runnable action) {
        Button button = button(label, action);
        row.addView(button, new LinearLayout.LayoutParams(0, dp(48), 1));
        return button;
    }

    private void chooseModel() {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.setType("*/*");
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(picker, PICK_MODEL);
    }

    private void addDrawerText(String text, int color) {
        TextView item = new TextView(this);
        item.setText(text);
        item.setTextColor(color);
        item.setPadding(0, 0, 0, dp(8));
        drawer.addView(item);
    }

    private void refreshDrawer() {
        for (int index = 0; index < tabs.length; ++index) {
            tabs[index].setSelected(index == openTab);
            tabs[index].setBackgroundColor(index == openTab ? FIELD : PANEL);
        }
        drawer.removeAllViews();
        drawer.setVisibility(openTab < 0 ? android.view.View.GONE : android.view.View.VISIBLE);
        if (openTab < 0) return;
        addDrawerText(headings[openTab], TEXT);
        if (openTab == 0 && !model.isEmpty()) {
            Button node = button(model, this::selectModel);
            node.setBackgroundColor(selected ? 0xff41464e : FIELD);
            drawer.addView(node, new LinearLayout.LayoutParams(-1, dp(44)));
        } else if (openTab == 1) {
            addDrawerText(selected ? model + "\nType   GLB model" : "Select a model", MUTED);
        } else if (openTab == 2) {
            Button importButton = button("Import GLB", this::chooseModel);
            importButton.setBackgroundColor(FIELD);
            drawer.addView(importButton, new LinearLayout.LayoutParams(-1, dp(44)));
            addDrawerText(model.isEmpty() ? "No assets" : model, MUTED);
        } else {
            addDrawerText("Empty scene", MUTED);
        }
    }

    public void showEditorModel(String name, boolean isSelected) {
        runOnUiThread(() -> {
            model = name;
            selected = isSelected;
            refreshDrawer();
        });
    }

    public void showEditorStatus(String text) {
        runOnUiThread(() -> status.setText(text));
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_MODEL || result != RESULT_OK || data == null || data.getData() == null)
            return;
        new Thread(() -> stageImport(data.getData()), "GLB import").start();
    }

    private void stageImport(Uri uri) {
        File staged = null;
        try {
            String name = "Model.glb";
            try (android.database.Cursor cursor = getContentResolver().query(
                uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0))
                    name = cursor.getString(0);
            }
            if (!name.toLowerCase(Locale.ROOT).endsWith(".glb")) {
                showEditorStatus("Choose a .glb file");
                return;
            }
            staged = File.createTempFile("import-", ".glb", getFilesDir());
            try (InputStream input = getContentResolver().openInputStream(uri);
                 FileOutputStream output = new FileOutputStream(staged)) {
                if (input == null) throw new java.io.IOException("Cannot open file");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            submitImport(staged.getAbsolutePath(), name);
            staged = null;
        } catch (Exception error) {
            showEditorStatus("Import failed: " + error.getMessage());
        } finally {
            if (staged != null) staged.delete();
        }
    }
}
