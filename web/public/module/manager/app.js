Ext.Loader.setConfig({enabled: true});
Ext.Loader.setPath('IVR', '/javascripts/app');

Ext.require([
    'IVR.store.Reports',
    'IVR.view.reports.List'
]);

Ext.onReady(function() {
    Ext.QuickTips.init();
    Ext.create('Ext.container.Viewport', {
        renderTo: Ext.getBody(),
        layout: 'border',
        items:
        [
            Ext.create('IVR.view.Header'),
			Ext.create('IVR.view.companies.Editor', {
        	    region: 'center'
            })
        ]
    })
});