#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <SDL3/SDL.h>
#include "../Platform.hpp"

static UIColor* color(unsigned rgb)
{
    return [UIColor colorWithRed:((rgb >> 16) & 255) / 255.0
                           green:((rgb >> 8) & 255) / 255.0
                            blue:(rgb & 255) / 255.0 alpha:1];
}

@interface EditorControls : NSObject <UIDocumentPickerDelegate>
@property(nonatomic, weak) UIViewController* host;
@property(nonatomic, strong) UILabel* status;
@property(nonatomic, strong) UIStackView* drawer;
@property(nonatomic, strong) NSArray<UIButton*>* tabs;
@property(nonatomic, copy) NSString* model;
@property(nonatomic) BOOL selected;
@property(nonatomic) NSInteger openTab;
- (void)refresh;
@end

@implementation EditorControls
- (void)importModel
{
    UTType* glb = [UTType typeWithFilenameExtension:@"glb" conformingToType:UTTypeData];
    UIDocumentPickerViewController* picker =
        [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[glb ?: UTTypeData] asCopy:YES];
    picker.delegate = self;
    [self.host presentViewController:picker animated:YES completion:nil];
}

- (void)documentPicker:(UIDocumentPickerViewController*)controller didPickDocumentsAtURLs:(NSArray<NSURL*>*)urls
{
    NSURL* source = urls.firstObject;
    if (!source) return;
    if (![source.pathExtension.lowercaseString isEqualToString:@"glb"])
    {
        showStatus("Choose a .glb file");
        return;
    }

    NSURL* temporary = [NSURL fileURLWithPath:
        [NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString]];
    NSError* error = nil;
    if (![NSFileManager.defaultManager copyItemAtURL:source toURL:temporary error:&error])
    {
        showStatus(error.localizedDescription.UTF8String);
        return;
    }
    enqueue(Action::Import, temporary.fileSystemRepresentation, source.lastPathComponent.UTF8String);
}

- (void)selectModel { enqueue(Action::Select); }
- (void)toggleTab:(UIButton*)button
{
    self.openTab = self.openTab == button.tag ? -1 : button.tag;
    [self refresh];
}

- (void)refresh
{
    for (UIButton* button in self.tabs)
    {
        const BOOL active = button.tag == self.openTab;
        button.accessibilityTraits = UIAccessibilityTraitButton | (active ? UIAccessibilityTraitSelected : 0);
        [button setTitleColor:color(active ? 0xe1e4e9 : 0xb4bcc7) forState:UIControlStateNormal];
        button.backgroundColor = color(active ? 0x2a2d32 : 0x202226);
    }
    for (UIView* view in self.drawer.arrangedSubviews)
        [view removeFromSuperview];
    self.drawer.hidden = self.openTab < 0;
    if (self.drawer.hidden) return;

    UILabel* title = [UILabel new];
    title.text = @[@"Scene", @"Properties", @"Assets"][self.openTab];
    title.textColor = color(0xe1e4e9);
    title.font = [UIFont boldSystemFontOfSize:14];
    [self.drawer addArrangedSubview:title];
    if (self.openTab == 0 && self.model.length)
    {
        UIButton* node = [UIButton buttonWithType:UIButtonTypeSystem];
        [node setTitle:self.model forState:UIControlStateNormal];
        [node setTitleColor:color(0xe1e4e9) forState:UIControlStateNormal];
        node.backgroundColor = color(self.selected ? 0x41464e : 0x2a2d32);
        node.layer.cornerRadius = 6;
        [node.heightAnchor constraintEqualToConstant:44].active = YES;
        [node addTarget:self action:@selector(selectModel) forControlEvents:UIControlEventTouchUpInside];
        [self.drawer addArrangedSubview:node];
        return;
    }
    if (self.openTab == 2)
    {
        UIButton* import = [UIButton buttonWithType:UIButtonTypeSystem];
        [import setTitle:@"Import GLB" forState:UIControlStateNormal];
        [import setTitleColor:color(0xe1e4e9) forState:UIControlStateNormal];
        import.backgroundColor = color(0x2a2d32);
        import.layer.cornerRadius = 6;
        [import.heightAnchor constraintEqualToConstant:44].active = YES;
        [import addTarget:self action:@selector(importModel) forControlEvents:UIControlEventTouchUpInside];
        [self.drawer addArrangedSubview:import];
    }
    UILabel* item = [UILabel new];
    item.textColor = color(0xb4bcc7);
    item.font = [UIFont systemFontOfSize:13];
    item.numberOfLines = 0;
    if (self.openTab == 1)
        item.text = self.selected ? [self.model stringByAppendingString:@"\nType   GLB model"] : @"Select a model";
    else
        item.text = self.model.length ? self.model : self.openTab == 0 ? @"Empty scene" : @"No assets";
    [self.drawer addArrangedSubview:item];
}

- (void)saveProject { enqueue(Action::Save); }
- (void)openProject { enqueue(Action::Open); }
@end

static EditorControls* controls;

void showStatus(const std::string& message)
{
    SDL_Log("%s", message.c_str());
    NSString* value = [NSString stringWithUTF8String:message.c_str()];
    dispatch_async(dispatch_get_main_queue(), ^{ controls.status.text = value; });
}

void showModel(const std::string& name, bool selected)
{
    NSString* value = [NSString stringWithUTF8String:name.c_str()];
    dispatch_async(dispatch_get_main_queue(), ^{
        controls.model = value;
        controls.selected = selected;
        [controls refresh];
    });
}

void installControls()
{
    SDL_Window* window = SDL_GetKeyboardFocus();
    if (!window)
    {
        int count = 0;
        SDL_Window** windows = SDL_GetWindows(&count);
        if (count) window = windows[0];
        SDL_free(windows);
    }
    UIWindow* host = (__bridge UIWindow*)SDL_GetPointerProperty(
        SDL_GetWindowProperties(window), SDL_PROP_WINDOW_UIKIT_WINDOW_POINTER, nullptr);
    UIViewController* controller = host.rootViewController;
    if (!controller) throw std::runtime_error("Cannot attach iOS editor controls");

    controls = [EditorControls new];
    controls.host = controller;
    controls.openTab = -1;
    controller.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    controller.view.backgroundColor = color(0x202226);
    UIStackView* toolbar = [UIStackView new];
    toolbar.distribution = UIStackViewDistributionFillEqually;
    const SEL actions[] = {@selector(importModel), @selector(saveProject), @selector(openProject)};
    NSArray<NSString*>* titles = @[@"Import GLB", @"Save", @"Open"];
    for (NSUInteger index = 0; index < titles.count; ++index)
    {
        UIButton* button = [UIButton buttonWithType:UIButtonTypeSystem];
        [button setTitle:titles[index] forState:UIControlStateNormal];
        [button setTitleColor:color(0xe1e4e9) forState:UIControlStateNormal];
        button.titleLabel.font = [UIFont systemFontOfSize:14 weight:UIFontWeightMedium];
        [button addTarget:controls action:actions[index] forControlEvents:UIControlEventTouchUpInside];
        [toolbar addArrangedSubview:button];
    }

    controls.status = [UILabel new];
    controls.status.textAlignment = NSTextAlignmentCenter;
    controls.status.font = [UIFont preferredFontForTextStyle:UIFontTextStyleFootnote];
    controls.status.adjustsFontSizeToFitWidth = YES;
    UIStackView* panel = [[UIStackView alloc] initWithArrangedSubviews:@[toolbar, controls.status]];
    panel.axis = UILayoutConstraintAxisVertical;
    panel.spacing = 0;
    controls.status.textColor = color(0xb4bcc7);
    panel.layoutMargins = UIEdgeInsetsMake(0, 8, 6, 8);
    panel.layoutMarginsRelativeArrangement = YES;
    panel.backgroundColor = color(0x202226);
    panel.translatesAutoresizingMaskIntoConstraints = NO;
    [controller.view addSubview:panel];

    UIStackView* tabBar = [UIStackView new];
    tabBar.distribution = UIStackViewDistributionFillEqually;
    tabBar.translatesAutoresizingMaskIntoConstraints = NO;
    NSMutableArray<UIButton*>* tabs = [NSMutableArray array];
    for (NSString* name in @[@"Scene", @"Properties", @"Assets"])
    {
        UIButton* button = [UIButton buttonWithType:UIButtonTypeSystem];
        button.tag = tabs.count;
        [button setTitle:name forState:UIControlStateNormal];
        [button setTitleColor:color(0xb4bcc7) forState:UIControlStateNormal];
        [button addTarget:controls action:@selector(toggleTab:) forControlEvents:UIControlEventTouchUpInside];
        [tabBar addArrangedSubview:button];
        [tabs addObject:button];
    }
    controls.tabs = tabs;
    controls.drawer = [UIStackView new];
    controls.drawer.axis = UILayoutConstraintAxisVertical;
    controls.drawer.spacing = 12;
    controls.drawer.layoutMargins = UIEdgeInsetsMake(14, 16, 18, 16);
    controls.drawer.layoutMarginsRelativeArrangement = YES;
    controls.drawer.backgroundColor = color(0x202226);
    controls.drawer.layer.cornerRadius = 12;
    controls.drawer.translatesAutoresizingMaskIntoConstraints = NO;

    UIView* bottom = [UIView new];
    bottom.translatesAutoresizingMaskIntoConstraints = NO;
    bottom.backgroundColor = color(0x202226);
    [controller.view addSubview:bottom];
    [controller.view addSubview:controls.drawer];
    [controller.view addSubview:tabBar];
    UILayoutGuide* safe = controller.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [panel.topAnchor constraintEqualToAnchor:safe.topAnchor],
        [panel.leadingAnchor constraintEqualToAnchor:controller.view.leadingAnchor],
        [panel.trailingAnchor constraintEqualToAnchor:controller.view.trailingAnchor],
        [toolbar.heightAnchor constraintEqualToConstant:44],
        [tabBar.heightAnchor constraintEqualToConstant:48],
        [tabBar.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor],
        [tabBar.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor],
        [tabBar.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor],
        [bottom.topAnchor constraintEqualToAnchor:tabBar.topAnchor],
        [bottom.bottomAnchor constraintEqualToAnchor:controller.view.bottomAnchor],
        [bottom.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor],
        [bottom.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor],
        [controls.drawer.bottomAnchor constraintEqualToAnchor:tabBar.topAnchor],
        [controls.drawer.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor],
        [controls.drawer.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor]
    ]];
    [controls refresh];
}
