import React           from 'react'
import * as _          from 'lodash'
import {Map}           from 'immutable'
import ReactDOM        from 'react-dom';
import io              from 'socket.io-client'

import {NodeView}      from './mNodeView'
import {NodeData}      from './NodeData'
import {NodeGraph}     from './NodeGraph'
import {Link}          from './mLink'
import {NewNodeDialog} from './mNewNodeDialog'
import {TypeSignature} from './TypeSignature'
import {EditManager}   from './EditManager'

import './App.css'


// todo: use asMutable to speed up some of the edits.
// todo: make nodeviews resize themselves to contain their nodes.
// todo: both nodeviews and ports must not drag the parent node
// todo: function def ports and names should show up on the same line.
// todo: link does not follow beyond the edge of the nodeview and this is bad for interaction
// todo: nodes must accept initial position
// todo: attempting a connection from outer node to inner behaves weirdly
//       (that's because each nodeView has its own temporary link)
//       (maybe that should be owned by the App)
// todo: the above also makes it impossible to connect function args to function body.
//       we should in general allow nodes to connect across nesting levels.
// todo: should we override and re-implement or take advantage of browser native focus traversal?
// todo: performance fix: only update port positions & node positions on drag stop.
//       find some other way (pass a callback, edit DOM directly?) to get the links to track.
// todo: xxx: links stopped updating after performance fix. GOD DAMMIT.


// someday: draw the type at the free end of the temporary link.


// don't really care what this is, for now:
const STANDIN_TYPE_SIGNATURE = new TypeSignature(['float', 'float', 'float'], [0,1])

// list of nodes read by the "place node" dialog.
const availableNodes = [
        new NodeData("+",           STANDIN_TYPE_SIGNATURE),
        new NodeData("-",           STANDIN_TYPE_SIGNATURE),
        new NodeData("*",           STANDIN_TYPE_SIGNATURE),
        new NodeData("/",           STANDIN_TYPE_SIGNATURE),
        new NodeData("function",    STANDIN_TYPE_SIGNATURE),
        new NodeData("helloWorld",  STANDIN_TYPE_SIGNATURE),
        new NodeData("sendHello",   STANDIN_TYPE_SIGNATURE),
        new NodeData("createWorld", STANDIN_TYPE_SIGNATURE),
        new NodeData("whatever",    STANDIN_TYPE_SIGNATURE)
    ]



class App extends React.Component {
    
    constructor(props) {
        super(props);
        this.state = this.getDefaultState();
        // neccesary to store across frames, or else the entire app will
        // redraw on every frame D:
        this.mutation_callbacks = {
            onLinkDisconnected    : this.onLinkDisconnected,
            onPortClicked         : this.onPortClicked,
            onPortMoved           : this.onPortMoved,
            onLinkEndpointClicked : this.onLinkEndpointClicked,
            onNodeMove            : this.onNodeMove
        }
        this.editMgr = new EditManager(this)
    }
    
    
    /****** Setup / init ******/
    
    
    getDefaultState() {
        return {
            ng : new NodeGraph(),
            
            // "partial link" logic:
            mouse_pos    : [0,0], // in local coords
            partial_link : null,  // anchor port
            
            // in window coords
            port_coords  : new Map(), 
            
            showing_node_dialog : false,
            
            selected_obj : null,  // xxx todo: not yet taken advantage of.
            
            connected    : false
        }
    }
    
    
    loadDefaultNodeGraph = () => {
        this.addNode("wat",                     
            new TypeSignature(
                ['float','float','float','float'], 
                [0,1,2]))
        this.addNode("+",                       
            new TypeSignature(
                ['int','int','int'],               
                [0,1]))
        this.addNode("a function named \"💩\"", 
            new TypeSignature(
                ['float','float','float','float'], 
                [0,1,2]))
        this.addNode("function",                
            new TypeSignature(
                ['str','str','str'],               
                [0,1]))
        this.addNode("child node",              
            new TypeSignature(
                ['str','str'],                     
                [0]),   
            3) // parent=3
        this.addNode("another kid",             
            new TypeSignature(
                ['str','str','str'],               
                [0,1]), 
            3) // parent=3
        
        this.addNode("type glyph demo", 
            new TypeSignature( 
                ['int','float','bool','type','str','list','proc','int'], 
                [0,1,2,3,4,5,6]))
        
        this.setPosition(0, [100,200])
        this.setPosition(1, [300,400])
    }
    
    
    componentDidMount = () => {
        this.loadDefaultNodeGraph()
        document.addEventListener('keydown', this.onHotKeyPressed);
    }
    
    
    setPosition = (node_id, pos) => {
        this.setState(prevState => {
            return { ng : prevState.ng.setPosition(node_id, pos) }
        })
    }
    
    
    addNode(name, type_sig, parent_id=null) {
        this.editMgr.action("addNode", [name, type_sig, parent_id])
    }
    
    
    
    /****** Object selection ******/
    // (not yet respected)
    
    
    selectNode(node_id) {
        this.setState({selected_obj : {
            kind : "node", 
            id   : node_id
        }})
    }
    
    
    selectPort(node_id, port_id) {
        this.setState({selected_obj: {
            kind : "port",
            id   : port_id
        }})
    }
    
    
    selectLink(link_id) {
        this.setState({ selected_obj: 
        {
            kind : "link",
            id   : link_id
        }})
    }
    
    
    selectNodeBody(node_id) {
        this.setState({ selected_obj :
        {
            kind : "node_body",
            id   : node_id
        }})
    }
    
    
    unselect() {
        this.setState({ selected_obj : null })
    }
    
    
    /****** Callback functions ******/
    
    
    setConnected = (connected) => {
        this.setState({connected : connected})
    }
    
    
    updateMouse = (x, y) => {
        var eDom    = ReactDOM.findDOMNode(this.elem);
        var box     = eDom.getBoundingClientRect()
        var new_pos = [x - box.left, y - box.top]
        // update the mouse position so that the partial link can follow it.
        if (!_.isEqual(this.state.mouse_mos, new_pos)) {
            this.setState({mouse_pos : new_pos});
        }
    }
    
    
    onPortClicked = ({node_id, port_id, elem, mouse_evt}) => {
        // create or complete the "partial" link
        var p = {node_id : node_id, port_id : port_id}
        if (this.state.partial_link === null) {
            this.setState({partial_link : p})
        } else {
            // complete a partial link
            var link = this.state.partial_link
            this.setState(prevState => ({
                partial_link : null
            }))
            this.editMgr.action("addLink", [link, p])
        }
    }
    
    
    onHotKeyPressed = (evt) => {
        if (evt.key === " " && !this.state.showing_node_dialog) {
            this.setState({showing_node_dialog : true})
            evt.preventDefault()
        }
    }
    
    
    onLinkDisconnected = (linkID) => {
        this.editMgr.action("removeLink", [linkID])
    }
    
    
    onPortMoved = ({node_id, port_id, is_sink, new_pos}) => {
        this.setState(prevState => {
            return {port_coords : prevState.port_coords.setIn([node_id, port_id], new_pos)}
        })
    }
    
    
    onNodeMove = (node_id, new_pos) => {
        this.setPosition(node_id, new_pos)
    }
    
    
    onMouseMove = (evt) => {
        if (this.state.partial_link !== null) {
            this.updateMouse(evt.clientX, evt.clientY)
        }
    }
    
    
    onClick = (evt) => {
        this.updateMouse(evt.clientX, evt.clientY)
        if (this.state.partial_link !== null) {
            // cancel the active link.
            this.setState({partial_link : null});
        }
    }
    
    
    onLinkEndpointClicked = ({mouseEvt, linkID, isSource}) => {
        var link = this.state.ng.links.get(linkID)
        // we want the endpoint that *wasn't* grabbed
        var port = isSource ? link.sink : link.src
        
        console.assert(this.state.partial_link === null);
        
        // "pick up" the link
        this.setState(prevState => ({
            partial_link : port
        }));
        this.editMgr.action("removeLink", [linkID])
    }
    
    
    onNodeCreate = (node) => {
        this.setState(prevState => {
            return {showing_node_dialog : false}
        })
        if (node !== null) {
           //this.editMgr.addNode(node.name, node.type_sig)
           this.editMgr.action("addNode", [node.name, node.type_sig])
        }
    }
    
    
    /****** Rendering functions ******/
    
    
    renderPartialLink() {
        if (this.state.partial_link !== null) {
            var port  = this.state.partial_link
            var i     = [port.node_id, port.port_id]
            var cxnPt = this.state.port_coords.getIn(i)
            var myDom = ReactDOM.findDOMNode(this.elem) // XXX update this in compDid{Update,Mount}
            var myBox = myDom.getBoundingClientRect()
            var pt    = [cxnPt[0] - myBox.left, cxnPt[1] - myBox.top]
            return (<Link
                points={[this.state.mouse_pos, pt]}
                partial={true}/>);
        }
    }
    
    
    renderNewNodeDialog() {
        return (
            <NewNodeDialog 
                className="NewNodeDialog"
                onNodeCreate={this.onNodeCreate}
                availableNodes={availableNodes}/>
        )
    }
    
    
    render() {
        // xxx hack below: _.clone() to cause extra updates.
        return (
            <div
                onMouseMove={this.onMouseMove}
                onClick={this.onClick}
                ref={e => {this.elem = e}}>
                <NodeView
                    ng={this.state.ng}
                    port_coords={this.state.port_coords}
                    mutation_callbacks={_.clone(this.mutation_callbacks)}/>
                {this.renderPartialLink()}
                {this.state.showing_node_dialog ? 
                    this.renderNewNodeDialog() :
                    []}
                {this.state.connected ? null : <p>NOT CONNECTED</p>}
            </div>
        );
    }
    
}

export default App;
