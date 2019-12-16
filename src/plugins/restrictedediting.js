import Plugin from '@ckeditor/ckeditor5-core/src/plugin';

import { toWidget,  toWidgetEditable, viewToModelPositionOutsideModelElement } from '@ckeditor/ckeditor5-widget/src/utils';
import Matcher from '@ckeditor/ckeditor5-engine/src/view/matcher';
import { getMarkerAtPosition, isSelectionInMarker, isPositionInRangeBoundaries } from './utils';
import ClickObserver from '@ckeditor/ckeditor5-engine/src/view/observer/clickobserver';



const HIGHLIGHT_CLASS = 'restricted-editing-exception_selected';


export default class RestrictedEditing extends Plugin {

    constructor( editor ) {
        super( editor );

        editor.config.define( 'restrictedEditing', {
            allowedCommands: [ 'bold', 'italic', 'comment', 'link', 'unlink' ]
        } );

        /**
         * Command names that are enabled outside non-restricted regions.
         *
         * @type {Set.<String>}
         * @private
         */
        this._alwaysEnabled = new Set( ['bold', 'undo', 'redo', 'comment', 'goToPreviousRestrictedEditingException', 'goToNextRestrictedEditingException' ] );

        /**
         * Commands allowed in non-restricted areas.
         *
         * Commands always enabled combines typing feature commands: `'typing'`, `'delete'` and `'forwardDelete'` with commands defined
         * in the feature configuration.
         *
         * @type {Set<string>}
         * @private
         */
        this._allowedInException = new Set( ['bold', 'input', 'comment', 'delete', 'forwardDelete' ] );
    }

    init() {
        const editor = this.editor;
        const model = editor.model;
        const doc = model.document;

        this._defineSchema();
        this._defineConverters();
        this._setupCommandsToggling();

        

        this.listenTo( this.editor.editing.view.document, 'clipboardInput', evt => {
                        evt.stop();
        }, { priority: 'highest' } );
        this.listenTo( this.editor.editing.view.document, 'clipboardOutput', ( evt, data ) => {
            if ( data.method == 'cut' ) {
                evt.stop();
            }
        }, { priority: 'highest' } );

        doc.registerPostFixer( extendMarkerOnTypingPostFixer( editor ) );
        doc.registerPostFixer( resurrectCollapsedMarkerPostFixer( editor ) );
        editor.editing.view.addObserver( ClickObserver );
    }

     

    _defineSchema() {                                                          // ADDED
        const schema = this.editor.model.schema;
        schema.extend( '$text', { allowAttributes: 'span' } );
    }

    _defineConverters() {                                                      // ADDED
        const conversion = this.editor.conversion;

        let markerNumber = 0;

        conversion.for( 'upcast' ).add( upcastHighlightToMarker( {
            view: {
                name: 'span',
                classes: 'mention-one'
            },
            model: () => {
                markerNumber++; // Starting from restrictedEditingException:1 marker.

                return `restrictedEditingException:${ markerNumber }`;
            }
        } ) );
        
       

        conversion.for( 'downcast' ).markerToHighlight( {
            model: 'restrictedEditingException',
            // Use callback to return new object every time new marker instance is created - otherwise it will be seen as the same marker.
            view: () => {
                return {
                    name: 'span',
                    classes: 'restricted-editing-exception',
                    priority: -10
                };
            }
        } );

        conversion.for( 'editingDowncast' ).markerToElement( {
            model: 'restrictedEditingException',
            view: ( markerData, viewWriter ) => {
                return viewWriter.createUIElement( 'span', {
                    class: 'restricted-editing-exception restricted-editing-exception_collapsed'
                } );
            }
        } );

        conversion.for( 'dataDowncast' ).markerToElement( {
            model: 'restrictedEditingException',
            view: ( markerData, viewWriter ) => {
                return viewWriter.createEmptyElement( 'span', {
                    class: 'restricted-editing-exception'
                } );
            }
        } );
        
        setupExceptionHighlighting(this.editor);
        

         function upcastHighlightToMarker( config ) {
            return dispatcher => dispatcher.on( 'element:span', ( evt, data, conversionApi ) => {
                const { writer } = conversionApi;
        
                const matcher = new Matcher( config.view );
                const matcherResult = matcher.match( data.viewItem );
        
                // If there is no match, this callback should not do anything.
                if ( !matcherResult ) {
                    return;
                }
        
                const match = matcherResult.match;
        
                // Force consuming element's name (taken from upcast helpers elementToElement converter).
                match.name = true;
        
                const { modelRange: convertedChildrenRange } = conversionApi.convertChildren( data.viewItem, data.modelCursor );
                conversionApi.consumable.consume( data.viewItem, match );
        
                const markerName = config.model( data.viewItem );
                const fakeMarkerStart = writer.createElement( '$marker', { 'data-name': markerName } );
                const fakeMarkerEnd = writer.createElement( '$marker', { 'data-name': markerName } );
        
                // Insert in reverse order to use converter content positions directly (without recalculating).
                writer.insert( fakeMarkerEnd, convertedChildrenRange.end );
                writer.insert( fakeMarkerStart, convertedChildrenRange.start );
        
                data.modelRange = writer.createRange(
                    writer.createPositionBefore( fakeMarkerStart ),
                    writer.createPositionAfter( fakeMarkerEnd )
                );
                data.modelCursor = data.modelRange.end;
            } );
        }

       

        function setupExceptionHighlighting( editor ) {
            const view = editor.editing.view;
            const model = editor.model;
            const highlightedMarkers = new Set();
        
            // Adding the class.
            view.document.registerPostFixer( writer => {
                const modelSelection = model.document.selection;
        
                const marker = getMarkerAtPosition( editor, modelSelection.anchor );
        
                if ( !marker ) {
                    return;
                }
        
                for ( const viewElement of editor.editing.mapper.markerNameToElements( marker.name ) ) {
                    writer.addClass( HIGHLIGHT_CLASS, viewElement );
                    highlightedMarkers.add( viewElement );
                }
            } );
        
            // Removing the class.
            editor.conversion.for( 'editingDowncast' ).add( dispatcher => {
                // Make sure the highlight is removed on every possible event, before conversion is started.
                dispatcher.on( 'insert', removeHighlight, { priority: 'highest' } );
                dispatcher.on( 'remove', removeHighlight, { priority: 'highest' } );
                dispatcher.on( 'attribute', removeHighlight, { priority: 'highest' } );
                dispatcher.on( 'selection', removeHighlight, { priority: 'highest' } );
        
                function removeHighlight() {
                    view.change( writer => {
                        for ( const item of highlightedMarkers.values() ) {
                            writer.removeClass( HIGHLIGHT_CLASS, item );
                            highlightedMarkers.delete( item );
                        }
                    } );
                }
            } );
        }

     
      

       
    }

    /**
     * Setups the commands toggling - enables or disables commands based on user selection.
     *
     * @private
     */
    _setupCommandsToggling() {
        const editor = this.editor;
        const model = editor.model;
        const doc = model.document;

        this._disableCommands( editor );

        this.listenTo( doc.selection, 'change', this._checkCommands.bind( this ) );
        this.listenTo( doc, 'change:data', this._checkCommands.bind( this ) );
    }

    /**
     * Checks if commands should be enabled or disabled based on current selection.
     *
     * @private
     */
    _checkCommands() {
        const editor = this.editor;
        const selection = editor.model.document.selection;

        if ( selection.rangeCount > 1 ) {
            this._disableCommands( editor );

            return;
        }

        const marker = getMarkerAtPosition( editor, selection.focus );

        this._disableCommands();

        if ( isSelectionInMarker( selection, marker ) ) {
            this._enableCommands( marker );
        }
    }

    /**
     * Enables commands in non-restricted regions.
     *
     * @returns {module:engine/model/markercollection~Marker} marker
     * @private
     */
    _enableCommands( marker ) {
        const editor = this.editor;

        const commands = this._getCommandNamesToToggle( editor, this._allowedInException )
            .filter( name => this._allowedInException.has( name ) )
            .filter( filterDeleteCommandsOnMarkerBoundaries( editor.model.document.selection, marker.getRange() ) )
            .map( name => editor.commands.get( name ) );

        for ( const command of commands ) {
            command.clearForceDisabled( 'RestrictedEditingMode' );
        }
    }

    /**
     * Disables commands outside non-restricted regions.
     *
     * @private
     */
    _disableCommands() {
        const editor = this.editor;
        const commands = this._getCommandNamesToToggle( editor )
            .map( name => editor.commands.get( name ) );

        for ( const command of commands ) {
            command.forceDisabled( 'RestrictedEditingMode' );
        }
    }

    /**
     * Returns command names that should be toggleable.
     *
     * @param {module:core/editor/editor~Editor} editor
     * @returns {Array.<String>}
     * @private
     */
    _getCommandNamesToToggle( editor ) {
        return Array.from( editor.commands.names() )
            .filter( name => !this._alwaysEnabled.has( name ) );
    }
}

function _tryExtendMarkerStart( editor, position, writer ) {
    const markerAtStart = getMarkerAtPosition( editor, position.getShiftedBy( 1 ) );

    if ( markerAtStart && markerAtStart.getStart().isEqual( position.getShiftedBy( 1 ) ) ) {
        writer.updateMarker( markerAtStart, {
            range: writer.createRange( markerAtStart.getStart().getShiftedBy( -1 ), markerAtStart.getEnd() )
        } );

        return true;
    }

    return false;
}

// Extend marker if typing detected on marker's end position.
function _tryExtendMarkedEnd( editor, position, writer ) {
    const markerAtEnd = getMarkerAtPosition( editor, position );

    if ( markerAtEnd && markerAtEnd.getEnd().isEqual( position ) ) {
        writer.updateMarker( markerAtEnd, {
            range: writer.createRange( markerAtEnd.getStart(), markerAtEnd.getEnd().getShiftedBy( 1 ) )
        } );

        return true;
    }

    return false;
}


export function extendMarkerOnTypingPostFixer( editor ) {
    // This post-fixer shouldn't be necessary after https://github.com/ckeditor/ckeditor5/issues/5778.
    return writer => {
        let changeApplied = false;

        for ( const change of editor.model.document.differ.getChanges() ) {
            if ( change.type == 'insert' && change.name == '$text' && change.length === 1 ) {
                changeApplied = _tryExtendMarkerStart( editor, change.position, writer ) || changeApplied;
                changeApplied = _tryExtendMarkedEnd( editor, change.position, writer ) || changeApplied;
            }
        }

        return false;
    };
}

export function resurrectCollapsedMarkerPostFixer( editor ) {
    // This post-fixer shouldn't be necessary after https://github.com/ckeditor/ckeditor5/issues/5778.
    return writer => {
        let changeApplied = false;

        for ( const [ name, data ] of editor.model.document.differ._changedMarkers ) {
            if ( name.startsWith( 'restrictedEditingException' ) && data.newRange.root.rootName == '$graveyard' ) {
                writer.updateMarker( name, {
                    range: writer.createRange( writer.createPositionAt( editor.model.document.selection.focus ) )
                } );

                changeApplied = true;
            }
        }

        return changeApplied;
    };
}

function filterDeleteCommandsOnMarkerBoundaries( selection, markerRange ) {
    return name => {
        if ( name == 'delete' && markerRange.start.isEqual( selection.focus ) ) {
            return false;
        }

        // Only for collapsed selection - non-collapsed seleciton that extends over a marker is handled elsewhere.
        if ( name == 'forwardDelete' && selection.isCollapsed && markerRange.end.isEqual( selection.focus ) ) {
            return false;
        }

        return true;
    };
}





