import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import TextWatcher from './textwatcher';
import { escapeRegExp } from 'lodash-es';

export default class ReplaceText extends Plugin {

	static get pluginName() {
		return 'ReplaceText';
	}

	/**
	 * @inheritDoc
	 */
	constructor( editor ) {
		super( editor );
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const model = editor.model;
		const doc = model.document;
		const input = editor.plugins.get( 'Input' );


        const spanData =  editor.config.get( 'replacementData' );
        
       
        
		let finalText= '', formattedValue =  '';
		const watcher = new TextWatcher( editor.model, text => {
			const modelSelection = doc.selection;
			const marker = getMarkerAtPosition(editor, modelSelection.anchor);
			if (!marker) {
				return false;
			}
			const markerName = marker.name.split(':')[1];
			const test = getLastTextLine(marker.getRange(), editor.model);
			finalText = test.text.replace(/\s/g, '').toLowerCase();
			const fillInvalue = spanData[markerName - 1];
			formattedValue = fillInvalue.spanContent.toLowerCase();
		
			if (finalText.length === 2 && formattedValue.startsWith(finalText)) {
				return true;
			}
			return false;
		});
	
				watcher.on( 'matched:data', ( evt, data ) => {
					if ( !input.isInput( data.batch ) ) {
						return;
					}
					const from = normalizeFrom( finalText );
					const to = normalizeTo( formattedValue );
					const matches = from.exec( data.text );
					console.log('matches', matches);
					const replaces = to( matches.slice( 1 ) );
					console.log('replaces', replaces);
					
	
					const matchedRange = data.range;
	
					let changeIndex = matches.index;
	
					model.enqueueChange( writer => {
						for ( let i = 1; i < matches.length; i++ ) {
							const match = matches[ i ];
							const replaceWith = replaces[ i - 1 ];
	
							if ( replaceWith == null ) {
								changeIndex += match.length;
	
								continue;
							}
	
							const replacePosition = matchedRange.start.getShiftedBy( changeIndex );
							const replaceRange = model.createRange( replacePosition, replacePosition.getShiftedBy( match.length ) );
							const attributes = getTextAttributesAfterPosition( replacePosition );
	
							model.insertContent( writer.createText( replaceWith, attributes ), replaceRange );
	
							changeIndex += replaceWith.length;
						}
					} );
				} );
		}
}

// Normalizes the configuration `from` parameter value.
// The normalized value for the `from` parameter is a RegExp instance. If the passed `from` is already a RegExp instance,
// it is returned unchanged.
//
// @param {String|RegExp} from
// @returns {RegExp}
function normalizeFrom( from ) {
	if ( typeof from == 'string' ) {
		return new RegExp( `(${ escapeRegExp( from ) })$` );
	}

	// `from` is already a regular expression.
	return from;
}

// Normalizes the configuration `to` parameter value.
// The normalized value for the `to` parameter is a function that takes an array and returns an array. See more in the
// configuration description. If the passed `to` is already a function, it is returned unchanged.
//
// @param {String|Array.<null|String>|Function} to
// @returns {Function}
function normalizeTo( to ) {
	if ( typeof to == 'string' ) {
		return () => [ to ];
	} else if ( to instanceof Array ) {
		return () => to;
	}

	// `to` is already a function.
	return to;
}

// For given `position` returns attributes for the text that is after that position.
// The text can be in the same text node as the position (`foo[]bar`) or in the next text node (`foo[]<$text bold="true">bar</$text>`).
//
// @param {module:engine/model/position~Position} position
// @returns {Iterable.<*>}
function getTextAttributesAfterPosition( position ) {
	const textNode = position.textNode ? position.textNode : position.nodeAfter;

	return textNode.getAttributes();
}

// Returns a RegExp pattern string that detects a sentence inside a quote.
//
// @param {String} quoteCharacter The character to create a pattern for.
// @returns {String}
function buildQuotesRegExp( quoteCharacter ) {
	return new RegExp( `(^|\\s)(${ quoteCharacter })([^${ quoteCharacter }]*)(${ quoteCharacter })$` );
}

// Reads text transformation config and returns normalized array of transformations objects.
//
// @param {module:typing/texttransformation~TextTransformationDescription} config
// @returns {Array.<module:typing/texttransformation~TextTransformationDescription>}
function getConfiguredTransformations( config ) {
	const extra = config.extra || [];
	const remove = config.remove || [];
	const isNotRemoved = transformation => !remove.includes( transformation );

	const configured = config.include.concat( extra ).filter( isNotRemoved );

	return expandGroupsAndRemoveDuplicates( configured )
		.filter( isNotRemoved ) // Filter out 'remove' transformations as they might be set in group
		.map( transformation => TRANSFORMATIONS[ transformation ] || transformation );
}

// Reads definitions and expands named groups if needed to transformation names.
// This method also removes duplicated named transformations if any.
//
// @param {Array.<String|Object>} definitions
// @returns {Array.<String|Object>}
function expandGroupsAndRemoveDuplicates( definitions ) {
	// Set is using to make sure that transformation names are not duplicated.
	const definedTransformations = new Set();

	for ( const transformationOrGroup of definitions ) {
		if ( TRANSFORMATION_GROUPS[ transformationOrGroup ] ) {
			for ( const transformation of TRANSFORMATION_GROUPS[ transformationOrGroup ] ) {
				definedTransformations.add( transformation );
			}
		} else {
			definedTransformations.add( transformationOrGroup );
		}
	}

	return Array.from( definedTransformations );
}

function getMarkerAtPosition(editor, position) {
	for (const marker of editor.model.markers) {
		const markerRange = marker.getRange();

		if (isPositionInRangeBoundaries(markerRange, position)) {
			if (marker.name.startsWith('restrictedEditingException:')) {
				return marker;
			}
		}
	}
}

function isPositionInRangeBoundaries(range, position) {
	return (
		range.containsPosition(position) ||
		range.end.isEqual(position) ||
		range.start.isEqual(position)
	);
}


function getLastTextLine(range, model) {
	let start = range.start;

	const text = Array.from(range.getItems()).reduce((rangeText, node) => {
		// Trim text to a last occurrence of an inline element and update range start.
		if (!(node.is('text') || node.is('textProxy'))) {
			start = model.createPositionAfter(node);

			return '';
		}

		return rangeText + node.data;
	}, '');

	return {
		text, range: model.createRange(start, range.end)
	};
}