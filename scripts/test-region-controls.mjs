export async function regionSection(page, section) {
    await page.locator('#rogue-tab-camp').click();
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const toggle = page.locator('[data-focus="camp-view:' + section + '"]');
    if (section === 'expansion') {
        await regionSection(page, 'operations');
        if (!await toggle.evaluate(node => node.parentNode.open)) {
            await toggle.evaluate(node => node.scrollIntoView({ block: 'center' }));
            await toggle.click();
        }
    } else if (await toggle.getAttribute('aria-expanded') !== 'true') {
        await toggle.evaluate(node => node.scrollIntoView({ block: 'center' }));
        await toggle.click();
    }
}

export async function warehouseFromPack(page) {
    while (await page.getByRole('dialog').count()) {
        await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    }
    await page.locator('#rogue-tab-party').click();
    await page.locator('#rogue-panel-party [data-focus="bagView:"]').click();
    const entry = page.locator('.rogue-dialog-content [data-focus="storageView:"]');
    await entry.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await entry.click();
}

export async function closeInventory(page) {
    while (await page.getByRole('dialog').count()) {
        await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    }
}
