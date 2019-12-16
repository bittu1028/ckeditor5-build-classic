import Plugin from '@ckeditor/ckeditor5-core/src/plugin';

import RestrictedEditing from './restrictedediting';

export default class Restricted extends Plugin {
    static get requires() {
        return [ RestrictedEditing ];
    }
}

